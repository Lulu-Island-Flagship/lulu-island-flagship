import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import {
  computeExpiredUnusedAmount,
  computeAvailableWalletBalance,
  computeWalletApplication,
  type WalletTransactionRecord,
} from "@/lib/wallet";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder";

function getSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        cookieStore.set({ name, value, ...options });
      },
      remove(name: string, options: CookieOptions) {
        cookieStore.set({ name, value: "", ...options });
      },
    },
  });
}

/**
 * POST /api/client/wallet/apply — { orderId }
 *
 * v8.3 E2.10: aplica el saldo disponible de la billetera (créditos vigentes,
 * no vencidos) a una orden propia que AÚN no fue cobrada (hold_captured_at Y
 * capture_captured_at ambos null, status='confirmed'). El monto aplicado se
 * guarda en orders.wallet_amount_used (en dólares, mismo formato que el
 * resto de columnas monetarias de `orders`) y el Batch Capture de las 7PM lo
 * resta del total antes de calcular Hold/saldo (ver cron/batch-capture).
 *
 * No permite aplicar a una orden ya capturada -- el precio ya sellado (B.2.11)
 * no se reabre; si el cliente quiere usar su crédito, debe hacerlo ANTES del
 * cobro de las 7PM.
 */
export async function POST(request: NextRequest) {
  const supabase = getSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { orderId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (!body.orderId) {
    return NextResponse.json({ error: "orderId es obligatorio" }, { status: 400 });
  }

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, user_id, status, hold_captured_at, capture_captured_at, wallet_amount_used, quote_id, quotes(total)")
    .eq("id", body.orderId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (orderError) return NextResponse.json({ error: orderError.message }, { status: 500 });
  if (!order) return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });

  if (order.hold_captured_at || order.capture_captured_at) {
    return NextResponse.json({ error: "Esta orden ya fue cobrada; no se puede aplicar crédito ahora." }, { status: 400 });
  }
  if (order.wallet_amount_used && order.wallet_amount_used > 0) {
    return NextResponse.json({ error: "Ya se aplicó crédito de billetera a esta orden." }, { status: 400 });
  }

  const { data: wallet, error: walletError } = await supabase
    .from("client_wallets")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  if (walletError) return NextResponse.json({ error: walletError.message }, { status: 500 });
  if (!wallet || wallet.balance <= 0) {
    return NextResponse.json({ error: "No hay saldo de billetera disponible." }, { status: 400 });
  }

  const { data: transactions, error: txError } = await supabase
    .from("wallet_transactions")
    .select("id, type, amount, expires_at, created_at")
    .eq("wallet_id", wallet.id)
    .order("created_at", { ascending: false })
    .limit(200);
  if (txError) return NextResponse.json({ error: txError.message }, { status: 500 });

  const records: WalletTransactionRecord[] = (transactions || []).map((t) => ({
    id: t.id,
    type: t.type,
    amount: t.amount,
    createdAtIso: t.created_at,
    expiresAtIso: t.expires_at,
  }));
  const nowIso = new Date().toISOString();
  const expiredUnusedAmount = computeExpiredUnusedAmount(records, nowIso);
  const availableBalanceCents = computeAvailableWalletBalance(wallet.balance, expiredUnusedAmount);

  const quoteTotalCents = Math.round(Number(order.quotes?.[0]?.total ?? 0) * 100);
  const applyCents = computeWalletApplication(availableBalanceCents, quoteTotalCents);

  if (applyCents <= 0) {
    return NextResponse.json({ error: "No hay saldo disponible para aplicar (puede estar vencido)." }, { status: 400 });
  }

  const newBalance = wallet.balance - applyCents;

  const { error: debitError } = await supabase.from("wallet_transactions").insert({
    wallet_id: wallet.id,
    user_id: user.id,
    order_id: order.id,
    type: "debit",
    amount: applyCents,
    balance_after: newBalance,
    description: `Aplicado a orden ${order.id}`,
  });
  if (debitError) return NextResponse.json({ error: debitError.message }, { status: 500 });

  const { error: walletUpdateError } = await supabase
    .from("client_wallets")
    .update({ balance: newBalance, updated_at: nowIso })
    .eq("id", wallet.id);
  if (walletUpdateError) return NextResponse.json({ error: walletUpdateError.message }, { status: 500 });

  const applyDollars = applyCents / 100;
  const { data: updatedOrder, error: orderUpdateError } = await supabase
    .from("orders")
    .update({ wallet_amount_used: applyDollars, updated_at: nowIso })
    .eq("id", order.id)
    .select("id, wallet_amount_used")
    .single();
  if (orderUpdateError) return NextResponse.json({ error: orderUpdateError.message }, { status: 500 });

  return NextResponse.json({ appliedCents: applyCents, newWalletBalance: newBalance, order: updatedOrder }, { status: 200 });
}

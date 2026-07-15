import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import {
  computeWalletCreditExpiryDate,
  computeExpiredUnusedAmount,
  computeAvailableWalletBalance,
  isExpiringWalletCreditType,
  type WalletTransactionRecord,
  type WalletTransactionType,
} from "@/lib/wallet";

/**
 * GET  /api/admin/wallet?userId=... — saldo + historial de un cliente.
 * POST /api/admin/wallet — otorga crédito: { userId, type: 'credit'|'promo'|'refund', amountDollars, description, orderId? }
 *
 * v8.3 E2.10 — Billetera Lulu (client_wallets/wallet_transactions, migración
 * 025) existía sin ningún código que la usara. 'credit'/'promo' expiran a
 * los 12 meses (wallet.ts); 'refund' no expira (es dinero que ya era del
 * cliente, ej. resolución de disputa). 'debit'/'payout' no se otorgan desde
 * aquí -- salen del gasto real del cliente o de un pago a tercero.
 *
 * Recurso RBAC: 'finance' (solo owner_admin) -- otorgar dinero a un cliente
 * es una decisión financiera, misma sensibilidad que pricing_settings.
 */
const GRANTABLE_TYPES: WalletTransactionType[] = ["credit", "promo", "refund"];

export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("finance", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const userId = request.nextUrl.searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "userId es obligatorio" }, { status: 400 });
  }

  const { data: wallet, error: walletError } = await auth.supabase
    .from("client_wallets")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (walletError) return NextResponse.json({ error: walletError.message }, { status: 500 });
  if (!wallet) {
    return NextResponse.json({ wallet: null, transactions: [], availableBalance: 0 }, { status: 200 });
  }

  const { data: transactions, error: txError } = await auth.supabase
    .from("wallet_transactions")
    .select("id, type, amount, balance_after, description, expires_at, created_at")
    .eq("wallet_id", wallet.id)
    .order("created_at", { ascending: false })
    .limit(100);
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
  const availableBalance = computeAvailableWalletBalance(wallet.balance, expiredUnusedAmount);

  return NextResponse.json(
    { wallet, transactions: transactions || [], availableBalance, expiredUnusedAmount },
    { status: 200 }
  );
}

interface GrantBody {
  userId?: string;
  type?: WalletTransactionType;
  amountDollars?: number;
  description?: string;
  orderId?: string;
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("finance", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;

  let body: GrantBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (!body.userId) {
    return NextResponse.json({ error: "userId es obligatorio" }, { status: 400 });
  }
  if (!body.type || !GRANTABLE_TYPES.includes(body.type)) {
    return NextResponse.json({ error: `type debe ser uno de: ${GRANTABLE_TYPES.join(", ")}` }, { status: 400 });
  }
  const amountDollars = Number(body.amountDollars);
  if (!Number.isFinite(amountDollars) || amountDollars <= 0) {
    return NextResponse.json({ error: "amountDollars debe ser > 0" }, { status: 400 });
  }
  const amountCents = Math.round(amountDollars * 100);

  const { data: wallet, error: walletError } = await supabase
    .from("client_wallets")
    .select("*")
    .eq("user_id", body.userId)
    .maybeSingle();
  if (walletError) return NextResponse.json({ error: walletError.message }, { status: 500 });
  if (!wallet) {
    return NextResponse.json({ error: "Este cliente no tiene billetera (sin client_profiles activo)" }, { status: 404 });
  }

  const nowIso = new Date().toISOString();
  const newBalance = wallet.balance + amountCents;
  const expiresAt = isExpiringWalletCreditType(body.type) ? computeWalletCreditExpiryDate(nowIso) : null;

  const { data: transaction, error: txError } = await supabase
    .from("wallet_transactions")
    .insert({
      wallet_id: wallet.id,
      user_id: body.userId,
      order_id: body.orderId || null,
      type: body.type,
      amount: amountCents,
      balance_after: newBalance,
      description: body.description?.trim() || null,
      expires_at: expiresAt,
    })
    .select()
    .single();
  if (txError) return NextResponse.json({ error: txError.message }, { status: 500 });

  const { error: updateError } = await supabase
    .from("client_wallets")
    .update({ balance: newBalance, updated_at: nowIso })
    .eq("id", wallet.id);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  return NextResponse.json({ transaction, newBalance }, { status: 201 });
}

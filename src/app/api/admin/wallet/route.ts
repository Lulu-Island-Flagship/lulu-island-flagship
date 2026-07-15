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
    .select("id")
    .eq("user_id", body.userId)
    .maybeSingle();
  if (walletError) return NextResponse.json({ error: walletError.message }, { status: 500 });
  if (!wallet) {
    return NextResponse.json({ error: "Este cliente no tiene billetera (sin client_profiles activo)" }, { status: 404 });
  }

  const nowIso = new Date().toISOString();
  const expiresAt = isExpiringWalletCreditType(body.type) ? computeWalletCreditExpiryDate(nowIso) : null;

  // v8.3 fix (auditoría 2026-07-15): mutación atómica vía RPC (migración 180)
  // en vez de leer balance + calcular en JS + UPDATE sin bloqueo -- ese
  // patrón permitía "lost updates" si dos operaciones tocaban la misma
  // billetera casi al mismo tiempo (ver comentario de la función SQL).
  const { data: rpcResult, error: rpcError } = await supabase.rpc("apply_wallet_delta", {
    p_wallet_id: wallet.id,
    p_user_id: body.userId,
    p_order_id: body.orderId || null,
    p_type: body.type,
    p_delta: amountCents,
    p_description: body.description?.trim() || null,
    p_expires_at: expiresAt,
  });
  if (rpcError) return NextResponse.json({ error: rpcError.message }, { status: 500 });
  const newBalance = rpcResult?.[0]?.new_balance ?? null;
  const transactionId = rpcResult?.[0]?.transaction_id ?? null;

  return NextResponse.json({ transactionId, newBalance }, { status: 201 });
}

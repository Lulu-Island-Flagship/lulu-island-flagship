
import { NextResponse } from "next/server";
import { createRouteSupabaseClient } from "@/lib/supabase-server";
import {
  computeExpiredUnusedAmount,
  computeAvailableWalletBalance,
  type WalletTransactionRecord,
} from "@/lib/wallet";
import { requireClientCaller } from "@/lib/require-client-caller";
// GET /api/client/wallet — saldo disponible (ya descontando créditos
// vencidos y no usados) + historial propio. v8.3 E2.10.
export async function GET() {
  const supabase = await createRouteSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientGuard = await requireClientCaller(supabase, user.id);
  if (!clientGuard.ok) {
    return NextResponse.json({ error: clientGuard.error }, { status: clientGuard.status });
  }

  const { data: wallet, error: walletError } = await supabase
    .from("client_wallets")
    .select("id, balance, currency")
    .eq("user_id", user.id)
    .maybeSingle();
  if (walletError) {
    console.error("walletError:", walletError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }
  if (!wallet) {
    return NextResponse.json({ balance: 0, availableBalance: 0, currency: "CAD", transactions: [] }, { status: 200 });
  }

  const { data: transactions, error: txError } = await supabase
    .from("wallet_transactions")
    .select("id, type, amount, balance_after, description, expires_at, created_at")
    .eq("wallet_id", wallet.id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (txError) {
    console.error("txError:", txError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }
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
    { balance: wallet.balance, availableBalance, currency: wallet.currency, transactions: transactions || [] },
    { status: 200 }
  );
}

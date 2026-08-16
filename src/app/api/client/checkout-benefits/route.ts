
import { NextResponse } from "next/server";
import {
  computeExpiredUnusedAmount,
  computeAvailableWalletBalance,
  type WalletTransactionRecord,
} from "@/lib/wallet";
import { toCentsBigInt } from "@/lib/money";
import { REFERRAL_CREDIT_CENTS } from "@/lib/referrals";
import { createRouteSupabaseClient } from "@/lib/supabase-server";
import { requireClientCaller } from "@/lib/require-client-caller";
/**
 * GET /api/client/checkout-benefits — informativo, para la pantalla de
 * reserva (/reserva/[quoteId]). Junta saldo de Lulu Wallet + crédito de
 * referido pendiente, para que el cliente vea "qué más se lleva" antes de
 * pagar.
 *
 * HONESTO sobre el alcance: esto es solo lectura/informativo. NO aplica
 * el saldo de wallet al total de esta reserva -- esa aplicación sigue
 * ocurriendo donde ya existía (billetera / batch-capture,
 * orders.wallet_amount_used_cents -- RAÍZ-3, migración 229), porque el precio de la cotización está
 * sellado server-side (B.2.11) y esta pantalla todavía trabaja sobre una
 * quote, no sobre una order ya creada. Cambiar eso sería tocar el motor
 * de precios/Hold, que se evita deliberadamente aquí.
 */
export async function GET() {
  const supabase = await createRouteSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clientGuard = await requireClientCaller(supabase, user.id);
  if (!clientGuard.ok) {
    return NextResponse.json({ error: clientGuard.error }, { status: clientGuard.status });
  }

  const { data: wallet } = await supabase
    .from("client_wallets")
    .select("id, balance, currency")
    .eq("user_id", user.id)
    .maybeSingle();

  let availableBalance = 0n;
  let currency = "CAD";
  if (wallet) {
    currency = wallet.currency;
    const { data: transactions } = await supabase
      .from("wallet_transactions")
      .select("id, type, amount, created_at, expires_at")
      .eq("wallet_id", wallet.id)
      .order("created_at", { ascending: false })
      .limit(50);
    const records: WalletTransactionRecord[] = (transactions || []).map((t) => ({
      id: t.id,
      type: t.type,
      // Borde de persistencia: NUMERIC → centavos bigint.
      amount: toCentsBigInt(t.amount),
      createdAtIso: t.created_at,
      expiresAtIso: t.expires_at,
    }));
    const nowIso = new Date().toISOString();
    const expiredUnusedAmount = computeExpiredUnusedAmount(records, nowIso);
    availableBalance = computeAvailableWalletBalance(toCentsBigInt(wallet.balance), expiredUnusedAmount);
  }

  const { data: pendingReferral } = await supabase
    .from("referrals")
    .select("id, status")
    .eq("referred_user_id", user.id)
    .eq("status", "pending")
    .maybeSingle();

  return NextResponse.json(
    {
      wallet: { availableBalance: Number(availableBalance), currency },
      referral: {
        hasPendingCredit: Boolean(pendingReferral),
        creditCents: REFERRAL_CREDIT_CENTS,
      },
    },
    { status: 200 }
  );
}

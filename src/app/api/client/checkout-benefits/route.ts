import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  computeExpiredUnusedAmount,
  computeAvailableWalletBalance,
  type WalletTransactionRecord,
} from "@/lib/wallet";
import { REFERRAL_CREDIT_CENTS } from "@/lib/referrals";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase-server";

function getSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        cookieStore.set({ name, value, ...options, httpOnly: true, secure: true, sameSite: "lax" });
      },
      remove(name: string, options: CookieOptions) {
        cookieStore.set({ name, value: "", ...options, httpOnly: true, secure: true, sameSite: "lax" });
      },
    },
  });
}

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
  const supabase = getSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: wallet } = await supabase
    .from("client_wallets")
    .select("id, balance, currency")
    .eq("user_id", user.id)
    .maybeSingle();

  let availableBalance = 0;
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
      amount: t.amount,
      createdAtIso: t.created_at,
      expiresAtIso: t.expires_at,
    }));
    const nowIso = new Date().toISOString();
    const expiredUnusedAmount = computeExpiredUnusedAmount(records, nowIso);
    availableBalance = computeAvailableWalletBalance(wallet.balance, expiredUnusedAmount);
  }

  const { data: pendingReferral } = await supabase
    .from("referrals")
    .select("id, status")
    .eq("referred_user_id", user.id)
    .eq("status", "pending")
    .maybeSingle();

  return NextResponse.json(
    {
      wallet: { availableBalance, currency },
      referral: {
        hasPendingCredit: Boolean(pendingReferral),
        creditCents: REFERRAL_CREDIT_CENTS,
      },
    },
    { status: 200 }
  );
}

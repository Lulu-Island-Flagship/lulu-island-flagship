import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { dispatchCommunication } from "@/lib/send-communication";
import { getVancouverTodayString } from "@/lib/date-utils";
import { computeWalletCreditExpiryDate } from "@/lib/wallet";
import { REFERRAL_CREDIT_CENTS, LEADER_MENTION_BONUS_CENTS } from "@/lib/referrals";

/**
 * POST /api/cron/referral-credit-grant — v8.3 E5.13 "Lulu Ambassador"
 *
 * Otorga el crédito de $30/$30 (referente + referido) cuando la primera
 * orden del referido llega a 'completed' -- nunca en el signup, para no
 * pagar por registros sin servicio real. Si el referido mencionó un líder
 * al canjear el código, también acredita el bono de $5 en
 * employee_referral_bonuses (se funde a nómina en el próximo ciclo, mismo
 * camino que employee_badge_bonuses).
 *
 * Los referrals marcados `flagged` (misma IP referente/referido) NUNCA se
 * acreditan automáticamente aquí -- requieren revisión humana (B.3.4);
 * quedan fuera de esta consulta a propósito (solo status='pending').
 *
 * Seguridad: requiere header Authorization: Bearer ${CRON_SECRET}
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const bearer = authHeader?.replace("Bearer ", "");
  if (bearer !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: "Supabase service credentials not configured" }, { status: 500 });
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const todayStr = getVancouverTodayString();

  try {
    const { data: pendingReferrals, error } = await supabase
      .from("referrals")
      .select("id, referrer_user_id, referred_user_id, mentioned_employee_id, created_at")
      .eq("status", "pending");

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    let credited = 0;
    const results: { referralId: string; status: string }[] = [];

    for (const referral of pendingReferrals || []) {
      // v8.3 fix (auditoría 2026-07-15): antes se tomaba la PRIMERA orden
      // completada del referido sin importar cuándo, así que un usuario que
      // ya tenía órdenes completadas ANTES de ser referido (reactivación con
      // el código de otro cliente, o un referral registrado después de que
      // el checkout ya generó una orden) disparaba el crédito usando una
      // orden vieja que el referido no motivó -- dinero real otorgado sin
      // el servicio real que el propio comentario de este archivo dice
      // garantizar. Ahora exige service_date >= referrals.created_at.
      const { data: completedOrder } = await supabase
        .from("orders")
        .select("id")
        .eq("user_id", referral.referred_user_id)
        .eq("status", "completed")
        .gte("service_date", (referral.created_at as string).slice(0, 10))
        .order("service_date", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!completedOrder) {
        results.push({ referralId: referral.id, status: "not_yet_completed" });
        continue;
      }

      const nowIso = new Date().toISOString();

      // Créditos de $30 a AMBAS billeteras. v8.3 fix (auditoría 2026-07-15):
      // mutación atómica vía RPC (migración 180) en vez de read-then-write
      // sin bloqueo -- este cron corre en paralelo a otros crons de
      // billetera (birthday-gift, pre-review-survey) y a aplicaciones de
      // wallet hechas por el cliente en vivo; sin bloqueo, dos de estos
      // tocando la misma billetera podían perder una actualización.
      for (const beneficiaryUserId of [referral.referrer_user_id, referral.referred_user_id]) {
        const { data: wallet } = await supabase
          .from("client_wallets")
          .select("id")
          .eq("user_id", beneficiaryUserId)
          .maybeSingle();
        if (!wallet) continue;

        await supabase.rpc("apply_wallet_delta", {
          p_wallet_id: wallet.id,
          p_user_id: beneficiaryUserId,
          p_order_id: completedOrder.id,
          p_type: "promo",
          p_delta: REFERRAL_CREDIT_CENTS,
          p_description: "Lulu Ambassador referral credit",
          p_expires_at: computeWalletCreditExpiryDate(nowIso),
        });
      }

      // Bono de $5 al líder mencionado, si lo hubo.
      if (referral.mentioned_employee_id) {
        await supabase.from("employee_referral_bonuses").insert({
          employee_id: referral.mentioned_employee_id,
          referral_id: referral.id,
          bonus_cents: LEADER_MENTION_BONUS_CENTS,
          credit_date: todayStr,
        });
      }

      await supabase
        .from("referrals")
        .update({ status: "credited", credited_at: nowIso, first_order_id: completedOrder.id })
        .eq("id", referral.id);

      await supabase
        .from("client_profiles")
        .update({ referral_credited_at: nowIso })
        .eq("user_id", referral.referred_user_id);

      const { data: referrerProfile } = await supabase
        .from("client_profiles")
        .select("preferred_languages")
        .eq("user_id", referral.referrer_user_id)
        .maybeSingle();
      const language = ((referrerProfile?.preferred_languages as string[] | undefined)?.[0] || "en") as
        | "en"
        | "zh"
        | "fr";

      const dispatchResult = await dispatchCommunication(supabase, {
        eventKey: "referral_credited",
        userId: referral.referrer_user_id,
        language,
        vars: { client_name: "there" },
      });

      credited++;
      results.push({ referralId: referral.id, status: dispatchResult.status });
    }

    return NextResponse.json(
      { evaluated: (pendingReferrals || []).length, credited, results },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

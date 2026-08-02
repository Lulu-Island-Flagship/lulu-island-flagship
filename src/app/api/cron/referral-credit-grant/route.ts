import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { dispatchCommunication } from "@/lib/send-communication";
import { getVancouverTodayString } from "@/lib/date-utils";
import { computeWalletCreditExpiryDate } from "@/lib/wallet";
import { REFERRAL_CREDIT_CENTS, LEADER_MENTION_BONUS_CENTS } from "@/lib/referrals";
import { safeErrorResponse } from "@/lib/api-errors";

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

    if (error) { console.error("Supabase query error:", error); return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 }); }

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

      // Fix CRÍTICO (auditoría externa de integridad financiera, 2026-08-02):
      // el UPDATE que marca `referrals.status = 'credited'` vivía AL FINAL de
      // este bloque, DESPUÉS de ya haber otorgado los 2 créditos de $30 vía
      // apply_wallet_delta -- y la query de arriba solo filtra por
      // `status = 'pending'`, leída una vez al principio del request. Si este
      // cron se invoca dos veces solapadas (mismo patrón de riesgo que ya se
      // corrigió en batch-capture con dispatch_runs), ambas invocaciones
      // podían traer el mismo referral 'pending' en su SELECT inicial y
      // ambas otorgar el crédito completo -- doble pago real de $30+$30 (y el
      // bono de $5 al líder) por el mismo referral. Se reclama (CAS) la fila
      // AQUÍ, ANTES de otorgar ningún crédito: solo la invocación que
      // efectivamente transiciona status 'pending' -> 'credited' (afecta 1
      // fila) continúa; la perdedora nunca llega a tocar wallet ni bonos.
      const { data: claimedReferral, error: claimError } = await supabase
        .from("referrals")
        .update({ status: "credited", credited_at: nowIso, first_order_id: completedOrder.id })
        .eq("id", referral.id)
        .eq("status", "pending")
        .select("id");

      if (claimError) {
        console.error(`CRITICAL: fallo al reclamar (CAS) el referral ${referral.id} antes de otorgar crédito:`, claimError);
        results.push({ referralId: referral.id, status: "claim_error" });
        continue;
      }

      if (!claimedReferral || claimedReferral.length === 0) {
        // Ya reclamado por otra invocación concurrente de este mismo cron --
        // nunca se otorga el crédito dos veces.
        results.push({ referralId: referral.id, status: "already_claimed_concurrently" });
        continue;
      }

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

      // (referrals.status ya se marcó 'credited' arriba, vía el CAS que
      // reclamó esta fila antes de otorgar cualquier crédito.)

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
        return safeErrorResponse(err);
  }
}

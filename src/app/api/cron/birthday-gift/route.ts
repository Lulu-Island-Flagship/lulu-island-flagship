import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireCronAuth } from "@/lib/cron-auth"; // Fix R5: Use constant-time requireCronAuth instead of inline comparison
import { dispatchCommunication } from "@/lib/send-communication";
import { getVancouverTodayString } from "@/lib/date-utils";
import { computeWalletCreditExpiryDate } from "@/lib/wallet";
import { computeBirthdayGiftEligibility, DEFAULT_BIRTHDAY_GIFT_CENTS } from "@/lib/rebook";
import { safeErrorResponse } from "@/lib/api-errors";

/**
 * POST /api/cron/birthday-gift — v8.3 E5.12
 *
 * "Cumpleaños con regalo configurable": corre diario, busca client_profiles
 * cuyo birth_date cae hoy (mes/día, Vancouver) y que no recibieron ya el
 * regalo este año calendario (last_birthday_gift_year), otorga el crédito
 * de Lulu Wallet (monto en loyalty_settings, configurable por el dueño vía
 * admin_update_config) y envía el evento 'birthday_gift'. birth_date es
 * opcional y provisto voluntariamente por el cliente -- clientes sin
 * fecha registrada simplemente no aparecen en esta consulta.
 *
 * Seguridad: requiere header Authorization: Bearer ${CRON_SECRET}
 */
export async function GET(request: NextRequest) {
  // Fix R5: Use constant-time requireCronAuth instead of inline comparison
  const authError = requireCronAuth(request);
  if (authError) return authError;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: "Supabase service credentials not configured" }, { status: 500 });
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const todayStr = getVancouverTodayString();
  const todayMonthDay = todayStr.slice(5); // "MM-DD"

  try {
    const { data: settings } = await supabase
      .from("loyalty_settings")
      .select("birthday_gift_amount_cents")
      .limit(1)
      .maybeSingle();
    const giftAmountCents = settings?.birthday_gift_amount_cents ?? DEFAULT_BIRTHDAY_GIFT_CENTS;

    // No hay operador nativo "mes/día" en PostgREST sin una función SQL
    // dedicada; se trae el conjunto acotado (birth_date no nulo) y se filtra
    // en memoria con la misma lógica pura ya testeada (computeBirthdayGiftEligibility).
    const { data: candidates, error } = await supabase
      .from("client_profiles")
      .select("id, user_id, birth_date, last_birthday_gift_year, preferred_languages")
      .not("birth_date", "is", null);

    if (error) {
      console.error("Supabase query error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    let granted = 0;
    const results: { userId: string; status: string }[] = [];

    for (const profile of candidates || []) {
      const decision = computeBirthdayGiftEligibility(
        profile.birth_date as string,
        todayStr,
        (profile.last_birthday_gift_year as number | null) ?? null
      );
      if (!decision.eligible) continue;

      const { data: wallet } = await supabase
        .from("client_wallets")
        .select("id")
        .eq("user_id", profile.user_id)
        .maybeSingle();

      if (!wallet) {
        results.push({ userId: profile.user_id, status: "no_wallet" });
        continue;
      }

      const nowIso = new Date().toISOString();
      // v8.3 fix (auditoría 2026-07-15): mutación atómica vía RPC (migración
      // 180) en vez de read-then-write sin bloqueo.
      await supabase.rpc("apply_wallet_delta", {
        p_wallet_id: wallet.id,
        p_user_id: profile.user_id,
        p_type: "promo",
        p_delta: giftAmountCents,
        p_description: `Birthday gift ${decision.year}`,
        p_expires_at: computeWalletCreditExpiryDate(nowIso),
      });

      await supabase
        .from("client_profiles")
        .update({ last_birthday_gift_year: decision.year, updated_at: nowIso })
        .eq("id", profile.id);

      const language = ((profile.preferred_languages as string[] | undefined)?.[0] || "en") as
        | "en"
        | "zh"
        | "fr";

      const result = await dispatchCommunication(supabase, {
        eventKey: "birthday_gift",
        userId: profile.user_id,
        language,
        vars: { client_name: "there", gift_amount: (giftAmountCents / 100).toFixed(2) },
      });

      granted++;
      results.push({ userId: profile.user_id, status: result.status });
    }

    return NextResponse.json(
      { evaluated: (candidates || []).length, granted, todayMonthDay, results },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

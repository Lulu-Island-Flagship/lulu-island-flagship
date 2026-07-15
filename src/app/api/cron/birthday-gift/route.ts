import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { dispatchCommunication } from "@/lib/send-communication";
import { getVancouverTodayString } from "@/lib/date-utils";
import { computeWalletCreditExpiryDate } from "@/lib/wallet";
import { computeBirthdayGiftEligibility, DEFAULT_BIRTHDAY_GIFT_CENTS } from "@/lib/rebook";

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
export async function POST(request: NextRequest) {
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
      return NextResponse.json({ error: error.message }, { status: 500 });
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
        .select("id, balance")
        .eq("user_id", profile.user_id)
        .maybeSingle();

      if (!wallet) {
        results.push({ userId: profile.user_id, status: "no_wallet" });
        continue;
      }

      const nowIso = new Date().toISOString();
      const newBalance = wallet.balance + giftAmountCents;
      await supabase.from("wallet_transactions").insert({
        wallet_id: wallet.id,
        user_id: profile.user_id,
        type: "promo",
        amount: giftAmountCents,
        balance_after: newBalance,
        description: `Birthday gift ${decision.year}`,
        expires_at: computeWalletCreditExpiryDate(nowIso),
      });
      await supabase
        .from("client_wallets")
        .update({ balance: newBalance, updated_at: nowIso })
        .eq("id", wallet.id);

      await supabase
        .from("client_profiles")
        .update({ last_birthday_gift_year: decision.year, updated_at: nowIso })
        .eq("id", profile.id);

      const language = ((profile.preferred_languages as string[] | undefined)?.[0] || "en") as
        | "en"
        | "es"
        | "zh";

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
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

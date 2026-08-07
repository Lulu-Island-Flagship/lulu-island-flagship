
import { NextRequest, NextResponse } from "next/server";
import { computeWalletCreditExpiryDate } from "@/lib/wallet";
import { dispatchCommunication } from "@/lib/send-communication";
import { isEligibleForReferralCode } from "@/lib/referrals";
import { createRouteSupabaseClient } from "@/lib/supabase-server";
import { requireClientCaller } from "@/lib/require-client-caller";
const SURVEY_WALLET_CREDIT_CENTS = 1000; // $10, fijo por spec (E5.7)

// Fix (auditoría 2026-07-31, hallazgo #18): igual que nps_surveys
// (ver src/app/api/client/nps-survey/route.ts), el pre_review_survey_token
// nunca expiraba -- ningún límite temporal impedía responder una encuesta
// enviada hace meses. Se reutiliza `orders.pre_review_survey_sent_at`
// (columna ya existente, migración 156, poblada por el cron de envío --
// src/app/api/cron/pre-review-survey/route.ts) en vez de agregar una
// columna nueva: cero riesgo de backfill sobre órdenes ya enviadas. 72h es
// más generoso que las 24h en las que se envía (spec E5.7: se envía 24h
// después del cierre) -- da margen real para que el cliente responda un
// mensaje de SMS/email sin dejar la ventana abierta indefinidamente.
const PRE_REVIEW_SURVEY_RESPONSE_WINDOW_MS = 72 * 60 * 60 * 1000;

/**
 * POST /api/client/pre-review-survey — { token, satisfied, complaintText? }
 *
 * v8.3 E5.7 — Encuesta interna 24h post-servicio. Otorga $10 de crédito a la
 * Billetera Lulu SIEMPRE que se complete (no depende de la respuesta -- el
 * incentivo es por el tiempo del cliente, nunca por una reseña pública,
 * B.2.18). Si complaintText no está vacío, abre un ticket de prioridad alta
 * (SLA 4h documentado) ANTES de que el cliente publique algo negativo.
 */
export async function POST(request: NextRequest) {
  const supabase = createRouteSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientGuard = await requireClientCaller(supabase, user.id);
  if (!clientGuard.ok) {
    return NextResponse.json({ error: clientGuard.error }, { status: clientGuard.status });
  }

  let body: { token?: string; satisfied?: boolean; complaintText?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (!body.token || typeof body.satisfied !== "boolean") {
    return NextResponse.json({ error: "token y satisfied son obligatorios" }, { status: 400 });
  }

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, user_id, service_date, pre_review_survey_sent_at")
    .eq("pre_review_survey_token", body.token)
    .maybeSingle();
  if (orderError) {
    console.error("orderError:", orderError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }
  if (!order || order.user_id !== user.id) {
    return NextResponse.json({ error: "Encuesta no encontrada" }, { status: 404 });
  }
  // Sin sent_at, la encuesta nunca fue disparada por el cron -- no hay
  // fecha de referencia para calcular una ventana, se rechaza (mismo
  // criterio deny-by-default que el resto del módulo cliente).
  if (
    !order.pre_review_survey_sent_at ||
    Date.now() - new Date(order.pre_review_survey_sent_at).getTime() > PRE_REVIEW_SURVEY_RESPONSE_WINDOW_MS
  ) {
    return NextResponse.json({ error: "Esta encuesta ya expiró" }, { status: 410 });
  }

  const { data: existing } = await supabase
    .from("pre_review_surveys")
    .select("id")
    .eq("order_id", order.id)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ error: "Ya se respondió esta encuesta" }, { status: 409 });
  }

  const complaintText = body.complaintText?.trim() || null;

  let ticketId: string | null = null;
  if (complaintText) {
    const { data: ticket, error: ticketError } = await supabase
      .from("tickets_disputas")
      .insert({
        order_id: order.id,
        type: "dispute",
        priority: "high",
        status: "open",
        context: {
          source: "pre_review_survey",
          sla_hours: 4,
          complaint_text: complaintText,
        },
      })
      .select("id")
      .single();
    if (ticketError) {
      console.error("ticketError:", ticketError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }
    ticketId = ticket.id;
  }

  const { data: survey, error: surveyError } = await supabase
    .from("pre_review_surveys")
    .insert({
      order_id: order.id,
      user_id: user.id,
      satisfied: body.satisfied,
      complaint_text: complaintText,
      wallet_credit_cents: SURVEY_WALLET_CREDIT_CENTS,
      ticket_id: ticketId,
    })
    .select()
    .single();
  if (surveyError) {
    console.error("surveyError:", surveyError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }
  // Otorgar el crédito de billetera (mismo patrón que /api/admin/wallet POST,
  // pero server-side sin pasar por el endpoint admin -- este SÍ es el
  // "sistema" otorgando, no un admin a mano).
  const { data: wallet } = await supabase
    .from("client_wallets")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (wallet) {
    const nowIso = new Date().toISOString();
    // v8.3 fix (auditoría 2026-07-15): mutación atómica vía RPC (migración
    // 180) en vez de read-then-write sin bloqueo.
    await supabase.rpc("apply_wallet_delta", {
      p_wallet_id: wallet.id,
      p_user_id: user.id,
      p_order_id: order.id,
      p_type: "credit",
      p_delta: SURVEY_WALLET_CREDIT_CENTS,
      p_description: "Encuesta interna post-servicio",
      p_expires_at: computeWalletCreditExpiryDate(nowIso),
    });
  }

  // v8.3 E5.12: "recordatorio de recomendación del líder" -- si el cliente
  // quedó satisfecho, se aprovecha este mismo momento (ya está pensando en
  // el servicio) para invitarlo a recomendar al líder de su equipo. Se
  // identifica al líder como quien dejó la nota de cierre (mismo criterio
  // que la "nota del líder" de la galería, E5.5); si no hay nota (nadie
  // dejó una), se omite en vez de inventar un nombre.
  if (body.satisfied) {
    const { data: noteLog } = await supabase
      .from("service_logs")
      .select("employee_id")
      .eq("order_id", order.id)
      .eq("event_type", "note")
      .not("notes", "is", null)
      .order("timestamp", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (noteLog?.employee_id) {
      const { data: employee } = await supabase
        .from("employees")
        .select("name")
        .eq("id", noteLog.employee_id)
        .maybeSingle();

      const { data: clientProfile } = await supabase
        .from("client_profiles")
        .select("preferred_languages")
        .eq("user_id", user.id)
        .maybeSingle();
      const language = ((clientProfile?.preferred_languages as string[] | undefined)?.[0] || "en") as
        | "en"
        | "zh"
        | "fr";

      // v8.3 fix (auditoría 2026-07-15): el comentario decía que el
      // programa de referidos "aún no estaba construido", pero sí existe y
      // está operativo (src/lib/referrals.ts, /api/client/referral,
      // /api/cron/referral-credit-grant) -- el link seguía apuntando a la
      // home genérica de todos modos, perdiendo la conversión en el
      // momento de mayor satisfacción del cliente. El programa es solo
      // para clientes VIP elegibles (>5 servicios, score>80) con un CÓDIGO
      // que se comparte manualmente desde /cuenta/referidos (no hay un
      // link de un solo clic con auto-canje todavía) -- por eso, si el
      // cliente no es elegible, se omite {referral_link} del envío en vez
      // de prometer algo que no puede usar.
      const { data: referralProfile } = await supabase
        .from("client_profiles")
        .select("services_count, score")
        .eq("user_id", user.id)
        .maybeSingle();
      const referralEligible = isEligibleForReferralCode(
        referralProfile?.services_count || 0,
        referralProfile?.score || 0
      );

      if (referralEligible) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.luluisland.ca";
        await dispatchCommunication(supabase, {
          eventKey: "leader_recommendation_reminder",
          userId: user.id,
          orderId: order.id,
          language,
          vars: {
            client_name: "there",
            leader_name: employee?.name || "your cleaning team",
            referral_link: `${appUrl}/account/referrals`,
          },
        });
      }
    }
  }

  return NextResponse.json({ survey, walletCreditCents: SURVEY_WALLET_CREDIT_CENTS }, { status: 201 });
}

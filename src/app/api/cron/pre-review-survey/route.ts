import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { dispatchCommunication } from "@/lib/send-communication";
import { getVancouverTodayString } from "@/lib/date-utils";
import { safeErrorResponse } from "@/lib/api-errors";

/**
 * POST /api/cron/pre-review-survey
 *
 * v8.3 E5.7 — Encuesta interna pre-reseña: 24h después del cierre, 30
 * segundos, $10 de crédito de Billetera Lulu. Corre diario y envía el link
 * (evento 'pre_review_survey', migración 156) a las órdenes completadas
 * AYER (Vancouver) que todavía no lo recibieron. El pago del crédito y la
 * creación de ticket por queja ocurren cuando el cliente RESPONDE (ver
 * /api/client/pre-review-survey), no aquí -- este cron solo envía.
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

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.luluisland.ca";
  const todayStr = getVancouverTodayString();
  const yesterday = new Date(new Date(`${todayStr}T00:00:00-07:00`).getTime() - 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  try {
    const { data: orders, error } = await supabase
      .from("orders")
      .select("id, user_id, service_date, pre_review_survey_token")
      .eq("status", "completed")
      .eq("service_date", yesterday)
      .is("pre_review_survey_sent_at", null);

    if (error) {
      console.error("Supabase query error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    let sent = 0;
    const results: { orderId: string; status: string }[] = [];

    for (const order of orders || []) {
      const { data: clientProfile } = await supabase
        .from("client_profiles")
        .select("preferred_languages")
        .eq("user_id", order.user_id)
        .maybeSingle();
      const language = ((clientProfile?.preferred_languages as string[] | undefined)?.[0] || "en") as
        | "en"
        | "zh"
        | "fr";

      const surveyLink = `${baseUrl.replace(/\/$/, "")}/encuesta/${order.pre_review_survey_token}`;

      const result = await dispatchCommunication(supabase, {
        eventKey: "pre_review_survey",
        userId: order.user_id,
        orderId: order.id,
        language,
        vars: { client_name: "there", service_date: order.service_date, survey_link: surveyLink },
      });

      await supabase
        .from("orders")
        .update({ pre_review_survey_sent_at: new Date().toISOString() })
        .eq("id", order.id);

      if (result.status === "sent" || result.status === "queued") sent++;
      results.push({ orderId: order.id, status: result.status });
    }

    return NextResponse.json({ evaluated: (orders || []).length, sent, results }, { status: 200 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

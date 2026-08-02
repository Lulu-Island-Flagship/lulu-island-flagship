import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { dispatchCommunication } from "@/lib/send-communication";
import { safeErrorResponse } from "@/lib/api-errors";

const NPS_SURVEY_INTERVAL_DAYS = 91; // trimestral (E10.13)

/**
 * POST /api/cron/nps-survey
 *
 * v8.3 E10.13 — Encuesta NPS trimestral por cliente. Selecciona clientes con
 * al menos 1 orden completada y sin encuesta enviada en los últimos 91 días
 * (o nunca), y envía el link vía evento 'nps_quarterly_survey' (migración
 * 163). Un registro por invitación: se completa cuando el cliente responde
 * (ver /api/client/nps-survey), este cron solo envía.
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

  try {
    // Clientes con al menos una orden completada (candidatos elegibles).
    const { data: completedOrders, error: ordersError } = await supabase
      .from("orders")
      .select("user_id")
      .eq("status", "completed");
    if (ordersError) {
      console.error("ordersError:", ordersError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }
    const eligibleUserIds = Array.from(new Set((completedOrders || []).map((o: { user_id: string }) => o.user_id)));

    const cutoffIso = new Date(Date.now() - NPS_SURVEY_INTERVAL_DAYS * 24 * 60 * 60 * 1000).toISOString();

    let sent = 0;
    const results: { userId: string; status: string }[] = [];

    for (const userId of eligibleUserIds) {
      const { data: lastSurvey } = await supabase
        .from("nps_surveys")
        .select("sent_at")
        .eq("client_user_id", userId)
        .is("deleted_at", null)
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastSurvey && lastSurvey.sent_at > cutoffIso) {
        continue; // ya se le envió dentro de la ventana trimestral
      }

      const { data: clientProfile } = await supabase
        .from("client_profiles")
        .select("preferred_languages")
        .eq("user_id", userId)
        .maybeSingle();
      const language = ((clientProfile?.preferred_languages as string[] | undefined)?.[0] || "en") as "en" | "zh" | "fr";

      const { data: survey, error: insertError } = await supabase
        .from("nps_surveys")
        .insert({ client_user_id: userId })
        .select("token")
        .single();
      if (insertError || !survey) {
        results.push({ userId, status: "error_creating_survey" });
        continue;
      }

      const surveyLink = `${baseUrl.replace(/\/$/, "")}/nps/${survey.token}`;

      const result = await dispatchCommunication(supabase, {
        eventKey: "nps_quarterly_survey",
        userId,
        language,
        vars: { client_name: "there", survey_link: surveyLink },
      });

      if (result.status === "sent" || result.status === "queued") sent++;
      results.push({ userId, status: result.status });
    }

    return NextResponse.json({ evaluated: eligibleUserIds.length, sent, results }, { status: 200 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

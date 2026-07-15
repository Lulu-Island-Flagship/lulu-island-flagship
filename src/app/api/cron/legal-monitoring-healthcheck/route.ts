import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isFeedBlind } from "@/lib/pipeda";

/**
 * POST /api/cron/legal-monitoring-healthcheck — v8.3 E9.7.
 *
 * Corre diario. Para cada feed activo de legal_monitoring_feeds, si lleva
 * >30 días sin `last_checked_at` (o nunca se chequeó desde su creación),
 * se considera "ciego" (criterio de aceptación de E9: "Feed legal
 * congelado 30 días (simulado) dispara la alerta de ceguera"). Si ya hay
 * una alerta de ceguera abierta para ese feed, no duplica.
 *
 * Fallback declarado en el plan además de esta alerta: revisión manual
 * trimestral de 1h -- este job también agenda la siguiente revisión en
 * legal_monitoring_quarterly_reviews si no hay una futura pendiente, para
 * que "agendada automáticamente" sea real y no solo texto del plan.
 *
 * Seguridad: requiere header Authorization: Bearer ${CRON_SECRET}, mismo
 * patrón que el resto de los crons (ver contract-ipc-adjustment/route.ts).
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

  const { data: feeds, error: feedsError } = await supabase
    .from("legal_monitoring_feeds")
    .select("id, entity_name, last_checked_at, created_at")
    .eq("active", true);

  if (feedsError) {
    return NextResponse.json({ error: feedsError.message }, { status: 500 });
  }

  const now = new Date();
  const newlyBlind: string[] = [];

  for (const feed of feeds || []) {
    const blind = isFeedBlind(
      feed.last_checked_at ? new Date(feed.last_checked_at) : null,
      new Date(feed.created_at),
      now
    );
    if (!blind) continue;

    const { data: existingAlert } = await supabase
      .from("legal_monitoring_blind_alerts")
      .select("id")
      .eq("feed_id", feed.id)
      .is("resolved_at", null)
      .maybeSingle();

    if (!existingAlert) {
      await supabase.from("legal_monitoring_blind_alerts").insert({ feed_id: feed.id });
      newlyBlind.push(feed.entity_name);
    }
  }

  // Agenda la próxima revisión trimestral si no hay una futura pendiente.
  const { data: futureReview } = await supabase
    .from("legal_monitoring_quarterly_reviews")
    .select("id")
    .is("completed_at", null)
    .gte("due_date", now.toISOString().slice(0, 10))
    .maybeSingle();

  let scheduledReview = false;
  if (!futureReview) {
    const dueDate = new Date(now);
    dueDate.setUTCMonth(dueDate.getUTCMonth() + 3);
    const dueDateStr = dueDate.toISOString().slice(0, 10);
    const { error: reviewError } = await supabase
      .from("legal_monitoring_quarterly_reviews")
      .insert({ due_date: dueDateStr })
      .select()
      .single();
    // Índice único en due_date: si dos ejecuciones colisionan el mismo día,
    // la segunda falla en silencio (ya existe la fila que se quería crear).
    scheduledReview = !reviewError;
  }

  return NextResponse.json(
    { checkedFeeds: (feeds || []).length, newlyBlind, scheduledReview },
    { status: 200 }
  );
}

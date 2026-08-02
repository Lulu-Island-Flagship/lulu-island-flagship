import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { isFeedBlind } from "@/lib/pipeda";
import { safeErrorResponse } from "@/lib/api-errors";

/**
 * GET /api/admin/legal-monitoring — v8.3 E9.7. Panel de los 7 entes
 * regulatorios (migración 142), con estado de ceguera calculado en vivo
 * (no depende solo de lo que el cron haya escrito) y las alertas de
 * cambio legal abiertas.
 *
 * PATCH /api/admin/legal-monitoring — marca un feed como "chequeado hoy",
 * opcionalmente registrando un cambio detectado (crea una fila en
 * legal_change_alerts). Este es el punto de entrada manual mientras no
 * exista scraping real de los 7 sitios (alcance explícitamente fuera de
 * este endpoint, ver migración 142).
 */
export async function GET() {
  const auth = await requireAdminRole("compliance");
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }
  const { supabase } = auth;

  const { data: feeds, error: feedsError } = await supabase
    .from("legal_monitoring_feeds")
    .select("id, entity_name, check_frequency, last_checked_at, last_change_detected_at, active, created_at")
    .eq("active", true)
    .order("entity_name", { ascending: true });

  if (feedsError) {
    console.error("admin/legal-monitoring error:", feedsError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  const { data: alerts, error: alertsError } = await supabase
    .from("legal_change_alerts")
    .select("id, feed_id, detected_at, change_description, dollar_impact_cents, suggested_actions, resolved_at")
    .is("deleted_at", null)
    .is("resolved_at", null)
    .order("detected_at", { ascending: false });

  if (alertsError) {
    console.error("admin/legal-monitoring error:", alertsError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  const now = new Date();
  const enrichedFeeds = (feeds || []).map((f) => ({
    ...f,
    isBlind: isFeedBlind(
      f.last_checked_at ? new Date(f.last_checked_at) : null,
      new Date(f.created_at),
      now
    ),
  }));

  return NextResponse.json(
    {
      feeds: enrichedFeeds,
      blindFeedCount: enrichedFeeds.filter((f) => f.isBlind).length,
      openAlerts: alerts || [],
    },
    { status: 200 }
  );
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAdminRole("compliance", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }
  const { supabase } = auth;

  try {
    const body = await request.json();
    const { feedId, changeDetected, changeDescription, dollarImpactCents, suggestedActions } = body as {
      feedId?: string;
      changeDetected?: boolean;
      changeDescription?: string;
      dollarImpactCents?: number;
      suggestedActions?: string[];
    };

    if (!feedId || typeof feedId !== "string") {
      return NextResponse.json({ error: "feedId is required" }, { status: 400 });
    }

    const nowIso = new Date().toISOString();
    const updatePayload: Record<string, unknown> = { last_checked_at: nowIso };
    if (changeDetected) {
      updatePayload.last_change_detected_at = nowIso;
    }

    const { data: feed, error } = await supabase
      .from("legal_monitoring_feeds")
      .update(updatePayload)
      .eq("id", feedId)
      .select()
      .single();

    if (error || !feed) {
      return NextResponse.json({ error: error?.message || "Feed not found" }, { status: 404 });
    }

    // Resolver cualquier alerta de ceguera abierta para este feed -- ya se
    // chequeó, deja de estar ciego.
    await supabase
      .from("legal_monitoring_blind_alerts")
      .update({ resolved_at: nowIso })
      .eq("feed_id", feedId)
      .is("resolved_at", null);

    let alert = null;
    if (changeDetected) {
      if (!changeDescription || changeDescription.trim().length === 0) {
        return NextResponse.json({ error: "changeDescription is required when changeDetected is true" }, { status: 400 });
      }
      const { data: createdAlert, error: alertError } = await supabase
        .from("legal_change_alerts")
        .insert({
          feed_id: feedId,
          change_description: changeDescription.trim(),
          dollar_impact_cents: typeof dollarImpactCents === "number" ? Math.round(dollarImpactCents) : null,
          suggested_actions: Array.isArray(suggestedActions) ? suggestedActions : [],
        })
        .select()
        .single();
      if (alertError) {
        console.error("admin/legal-monitoring error:", alertError);
        return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
      }
      alert = createdAlert;
    }

    return NextResponse.json({ feed, alert }, { status: 200 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { canAddCompetitor, detectCompetitorAlerts, type CompetitorSnapshot } from "@/lib/competitor-tracking";

// GET /api/admin/competencia — dashboard comparativo: competidores activos +
// último snapshot de cada uno + alertas sin reconocer. Alimenta el mismo
// panel que el checklist manual de E1 (criterio de aceptación E10): la
// tabla `competitor_snapshots` no distingue origen para efectos de lectura,
// solo guarda `source` como metadata.
//
// POST /api/admin/competencia — dos acciones:
//   { action: "add_competitor", name, zone, notes? } — usa canAddCompetitor()
//     (tope 10 activos, D.10.10) antes de insertar.
//   { action: "add_snapshot", competitorId, priceCents, services, activePromotions,
//     averageRating, reviewCount, source } — inserta el snapshot y corre
//     detectCompetitorAlerts() contra el snapshot anterior + la lista de
//     competidores conocidos; persiste las alertas generadas.
//
// Resource "finance": mismo bucket que /api/admin/accounting, porque el
// panel de precios de competencia vive dentro de contabilidad (spec E9.13:
// "Precios de competencia en el panel [de contabilidad]"). admin-rbac.ts no
// se toca en esta tanda, así que no hay un recurso "marketing" dedicado.

export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("finance", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: competitors, error: compError } = await supabase
    .from("competitors")
    .select("id, name, zone, notes")
    .is("deleted_at", null)
    .order("name");
  if (compError) {
    return NextResponse.json({ error: compError.message }, { status: 500 });
  }

  const competitorIds = (competitors || []).map((c: { id: string }) => c.id);

  const { data: snapshots, error: snapError } = await supabase
    .from("competitor_snapshots")
    .select("*")
    .in("competitor_id", competitorIds.length ? competitorIds : ["00000000-0000-0000-0000-000000000000"])
    .order("captured_at", { ascending: false });
  if (snapError) {
    return NextResponse.json({ error: snapError.message }, { status: 500 });
  }

  const latestByCompetitor = new Map<string, unknown>();
  for (const snap of snapshots || []) {
    const s = snap as { competitor_id: string };
    if (!latestByCompetitor.has(s.competitor_id)) {
      latestByCompetitor.set(s.competitor_id, snap);
    }
  }

  const { data: alerts, error: alertError } = await supabase
    .from("competitor_alerts")
    .select("*")
    .is("acknowledged_at", null)
    .order("created_at", { ascending: false });
  if (alertError) {
    return NextResponse.json({ error: alertError.message }, { status: 500 });
  }

  return NextResponse.json(
    {
      competitors: (competitors || []).map((c: { id: string; name: string; zone: string; notes: string | null }) => ({
        ...c,
        latestSnapshot: latestByCompetitor.get(c.id) || null,
      })),
      activeCount: (competitors || []).length,
      unacknowledgedAlerts: alerts || [],
    },
    { status: 200 }
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("finance", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();

  if (body.action === "add_competitor") {
    const { count, error: countError } = await supabase
      .from("competitors")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null);
    if (countError) {
      return NextResponse.json({ error: countError.message }, { status: 500 });
    }
    const check = canAddCompetitor(count || 0);
    if (!check.allowed) {
      return NextResponse.json({ error: check.reason }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("competitors")
      .insert({ name: body.name, zone: body.zone, notes: body.notes ?? null })
      .select()
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ competitor: data }, { status: 201 });
  }

  if (body.action === "add_snapshot") {
    const { data: competitor, error: compError } = await supabase
      .from("competitors")
      .select("id, name")
      .eq("id", body.competitorId)
      .is("deleted_at", null)
      .single();
    if (compError || !competitor) {
      return NextResponse.json({ error: "Competidor no encontrado" }, { status: 404 });
    }

    const { data: allCompetitors } = await supabase.from("competitors").select("id").is("deleted_at", null);
    const knownCompetitorIds = (allCompetitors || []).map((c: { id: string }) => c.id);

    const { data: previousRow } = await supabase
      .from("competitor_snapshots")
      .select("*")
      .eq("competitor_id", body.competitorId)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const current: CompetitorSnapshot = {
      competitorId: body.competitorId,
      competitorName: competitor.name,
      capturedAt: new Date().toISOString(),
      source: body.source === "scraping" ? "scraping" : "manual_checklist",
      priceCents: body.priceCents,
      services: body.services || [],
      activePromotions: body.activePromotions || [],
      averageRating: body.averageRating,
      reviewCount: body.reviewCount,
      zone: body.zone,
    };

    const previous: CompetitorSnapshot | null = previousRow
      ? {
          competitorId: previousRow.competitor_id,
          competitorName: competitor.name,
          capturedAt: previousRow.captured_at,
          source: previousRow.source,
          priceCents: previousRow.price_cents,
          services: previousRow.services,
          activePromotions: previousRow.active_promotions,
          averageRating: Number(previousRow.average_rating),
          reviewCount: previousRow.review_count,
          zone: body.zone,
        }
      : null;

    const { error: insertError } = await supabase.from("competitor_snapshots").insert({
      competitor_id: current.competitorId,
      source: current.source,
      price_cents: current.priceCents,
      services: current.services,
      active_promotions: current.activePromotions,
      average_rating: current.averageRating,
      review_count: current.reviewCount,
    });
    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    // knownCompetitorIds ANTES de este snapshot es lo que detectNewCompetitor
    // necesita; como el competidor ya existía (insertamos snapshot para uno
    // existente), nunca dispara "nuevo" aquí — eso es correcto: "nuevo" es
    // para cuando add_competitor crea uno que antes no estaba en la lista
    // que el caller ya conocía. Se deja la detección igual porque es pura e
    // idempotente; el caller real (job semanal futuro) sí tendrá una lista
    // "conocida hasta ayer" distinta de la de hoy.
    const alerts = detectCompetitorAlerts(current, previous, knownCompetitorIds);

    if (alerts.length > 0) {
      const { error: alertInsertError } = await supabase.from("competitor_alerts").insert(
        alerts.map((a) => ({
          competitor_id: a.competitorId,
          alert_type: a.type,
          severity: a.severity,
          reason: a.reason,
        }))
      );
      if (alertInsertError) {
        return NextResponse.json({ error: alertInsertError.message }, { status: 500 });
      }
    }

    return NextResponse.json({ snapshot: current, alerts }, { status: 201 });
  }

  return NextResponse.json({ error: "Acción no reconocida" }, { status: 400 });
}

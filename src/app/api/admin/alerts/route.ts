import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { sortAlertsBySeverity, type UnifiedAlertSeverity } from "@/lib/unified-alerts";

/**
 * GET  /api/admin/alerts — bandeja unificada (v8.3 E0.6). Por defecto solo
 *      alertas abiertas/reconocidas, ordenadas P0→P1→P2 y luego por
 *      antigüedad. ?status=all para incluir resueltas.
 * POST /api/admin/alerts — { action: "acknowledge"|"resolve", id }
 *
 * Recurso RBAC: 'feature_flags' (solo owner_admin) es demasiado restrictivo
 * para esto -- la bandeja debe ser visible para quien despacha/supervisa el
 * día a día. Se usa 'risk_assessments' (owner_admin + ops_coordinator),
 * mismo patrón que el resto de módulos de excepciones de campo en esta
 * sesión.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("risk_assessments", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const includeAll = new URL(request.url).searchParams.get("status") === "all";

  let query = auth.supabase
    .from("unified_alerts")
    .select(
      "id, source_module, source_table, source_id, tier, severity, title, summary, status, acknowledged_at, resolved_at, created_at"
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(200);

  if (!includeAll) {
    query = query.in("status", ["open", "acknowledged"]);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const alerts = sortAlertsBySeverity(
    (data || []) as { severity: UnifiedAlertSeverity; created_at: string; [key: string]: unknown }[]
  );

  return NextResponse.json({ alerts }, { status: 200 });
}

interface AlertActionBody {
  action?: "acknowledge" | "resolve";
  id?: string;
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("risk_assessments", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;

  let body: AlertActionBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (!body.id || (body.action !== "acknowledge" && body.action !== "resolve")) {
    return NextResponse.json({ error: "Se requiere { action: 'acknowledge'|'resolve', id }" }, { status: 400 });
  }

  const { data: actorEmployee } = await supabase
    .from("employees")
    .select("id")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  const nowIso = new Date().toISOString();
  const update =
    body.action === "acknowledge"
      ? { status: "acknowledged", acknowledged_at: nowIso, acknowledged_by: actorEmployee?.id ?? null }
      : { status: "resolved", resolved_at: nowIso, resolved_by: actorEmployee?.id ?? null };

  const { data, error } = await supabase
    .from("unified_alerts")
    .update(update)
    .eq("id", body.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ alert: data }, { status: 200 });
}

import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, logAdminAction } from "@/lib/admin";
import { roleAllows } from "@/lib/admin-rbac";
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
 *
 * Fix (auditoría externa, hallazgo confirmado 2026-08-02): las alertas con
 * source_module='access_recovery' (verificación de un trusted_successor
 * recuperando acceso) se colaban en esta bandeja aunque `access_recovery`
 * es un recurso owner_admin-only en la matriz -- un ops_coordinator con
 * acceso a 'risk_assessments' podía ver esas alertas igual. Ahora se
 * filtran server-side si el usuario no tiene el recurso 'access_recovery'.
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
  if (error) {
    console.error("admin/alerts error:", error);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  const canSeeAccessRecovery = roleAllows(auth.roles, "access_recovery");
  const visible = (data || []).filter(
    (row) => canSeeAccessRecovery || row.source_module !== "access_recovery"
  );

  const alerts = sortAlertsBySeverity(
    visible as { severity: UnifiedAlertSeverity; created_at: string; [key: string]: unknown }[]
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

  const logResult = await logAdminAction({
    supabase: auth.supabase, user: auth.user, roles: auth.roles,
    resource: "risk_assessments", method: request.method, path: request.url,
  });
  if (logResult.error) return NextResponse.json({ error: logResult.error }, { status: logResult.status });

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

  // Fix (auditoría externa, hallazgo confirmado 2026-08-02): mismo control
  // que el GET -- un ops_coordinator no debe poder acknowledge/resolve una
  // alerta de source_module='access_recovery' (recurso owner_admin-only).
  if (!roleAllows(auth.roles, "access_recovery")) {
    const { data: targetAlert } = await supabase
      .from("unified_alerts")
      .select("source_module")
      .eq("id", body.id)
      .maybeSingle();
    if (targetAlert?.source_module === "access_recovery") {
      return NextResponse.json({ error: "Forbidden — resource 'access_recovery' requires a role you don't have" }, { status: 403 });
    }
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

  if (error) {
    console.error("admin/alerts error:", error);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  return NextResponse.json({ alert: data }, { status: 200 });
}

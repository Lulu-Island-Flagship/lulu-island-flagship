import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, getServiceRoleClient } from "@/lib/admin";
import { evaluateEmployeeMarketingVisibility, canAdminApprove } from "@/lib/employee-marketing";

// GET /api/admin/employee-marketing — todos los features con visibilidad calculada.
// POST /api/admin/employee-marketing — { action: "approve" | "set_asset_url", featureId, assetUrl? }
//   "approve" solo procede si canAdminApprove() lo permite (consentimiento vigente).
//
// Resource "finance": mismo bucket que seo-local/attribution/partners.
//
// v8.3 E11 (auditoría 2026-07-18): employee_marketing_features solo tiene
// políticas RLS de self-select/self-update para el empleado dueño del
// registro (migración 162); el acceso admin es `USING (false)` -- "vía
// service role en la API" que nunca se implementó. requireAdminRole()
// sigue autorizando (rol + audit log), pero las operaciones de datos del
// lado admin usan el cliente service role. (El endpoint del empleado,
// src/app/api/empleado/marketing-consent/route.ts, sigue con el cliente
// de sesión normal -- ese sí lo cubre RLS.)

export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("finance", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!auth.supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const supabase = getServiceRoleClient();
  if (!supabase) {
    return NextResponse.json({ error: "Server misconfigured (service role)" }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("employee_marketing_features")
    .select(
      "id, employee_id, feature_type, employee_consented_at, employee_consent_withdrawn_at, admin_approved_at, asset_url, notes, employees:employee_id ( name )"
    )
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const features = (data || []).map((f) => ({
    ...f,
    employeeName: (f.employees as unknown as { name: string } | null)?.name ?? "Unknown",
    visibility: evaluateEmployeeMarketingVisibility({
      employeeConsentedAt: f.employee_consented_at,
      employeeConsentWithdrawnAt: f.employee_consent_withdrawn_at,
      adminApprovedAt: f.admin_approved_at,
    }),
  }));

  return NextResponse.json({ features }, { status: 200 });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("finance", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { user } = auth;
  if (!auth.supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const supabase = getServiceRoleClient();
  if (!supabase) {
    return NextResponse.json({ error: "Server misconfigured (service role)" }, { status: 500 });
  }

  const body = await request.json();
  if (!body.featureId) {
    return NextResponse.json({ error: "featureId requerido" }, { status: 400 });
  }

  const { data: feature, error: fetchError } = await supabase
    .from("employee_marketing_features")
    .select("id, employee_consented_at, employee_consent_withdrawn_at, admin_approved_at")
    .eq("id", body.featureId)
    .is("deleted_at", null)
    .single();
  if (fetchError || !feature) {
    return NextResponse.json({ error: "Feature no encontrado" }, { status: 404 });
  }

  if (body.action === "approve") {
    const check = canAdminApprove({
      employeeConsentedAt: feature.employee_consented_at,
      employeeConsentWithdrawnAt: feature.employee_consent_withdrawn_at,
      adminApprovedAt: feature.admin_approved_at,
    });
    if (!check.allowed) {
      return NextResponse.json({ error: check.reason }, { status: 400 });
    }
    const { error } = await supabase
      .from("employee_marketing_features")
      .update({ admin_approved_at: new Date().toISOString(), admin_approved_by: user?.id ?? null, updated_at: new Date().toISOString() })
      .eq("id", feature.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  if (body.action === "set_asset_url") {
    const { error } = await supabase
      .from("employee_marketing_features")
      .update({ asset_url: body.assetUrl ?? null, updated_at: new Date().toISOString() })
      .eq("id", feature.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  return NextResponse.json({ error: "Acción no reconocida" }, { status: 400 });
}

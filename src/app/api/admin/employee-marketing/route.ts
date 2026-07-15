import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { evaluateEmployeeMarketingVisibility, canAdminApprove } from "@/lib/employee-marketing";

// GET /api/admin/employee-marketing — todos los features con visibilidad calculada.
// POST /api/admin/employee-marketing — { action: "approve" | "set_asset_url", featureId, assetUrl? }
//   "approve" solo procede si canAdminApprove() lo permite (consentimiento vigente).
//
// Resource "finance": mismo bucket que seo-local/attribution/partners.

export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("finance", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
  const { supabase, user } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

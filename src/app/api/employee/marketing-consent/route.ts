
import { NextRequest, NextResponse } from "next/server";
import { evaluateEmployeeMarketingVisibility } from "@/lib/employee-marketing";
import { requireActiveEmployee } from "@/lib/require-active-employee";
import { safeErrorResponse } from "@/lib/api-errors";
import { createRouteSupabaseClient } from "@/lib/supabase-server";
/**
 * v8.3 E10.8 — Consentimiento del empleado para marketing (reels "un día en
 * la vida" / insignias públicas en el sitio). El empleado solo puede ver y
 * modificar SUS propios registros (RLS lo impone también, esto es defensa
 * en profundidad).
 *
 * GET  /api/employee/marketing-consent — mis features + visibilidad calculada.
 * POST /api/employee/marketing-consent — { action: "consent" | "withdraw", featureType }
 *   "consent" crea el registro si no existe (o re-consiente si nunca hubo fila).
 */
export async function GET() {
  const supabase = await createRouteSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { employee, error: empError, status: empStatus } = await requireActiveEmployee(supabase, user.id);
  if (!employee) return NextResponse.json({ error: empError }, { status: empStatus });

  const { data, error } = await supabase
    .from("employee_marketing_features")
    .select("id, feature_type, employee_consented_at, employee_consent_withdrawn_at, admin_approved_at, asset_url")
    .eq("employee_id", employee.id)
    .is("deleted_at", null);

  if (error) {
    console.error("Supabase query error:", error);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  const features = (data || []).map((f) => ({
    ...f,
    visibility: evaluateEmployeeMarketingVisibility({
      employeeConsentedAt: f.employee_consented_at,
      employeeConsentWithdrawnAt: f.employee_consent_withdrawn_at,
      adminApprovedAt: f.admin_approved_at,
    }),
  }));

  return NextResponse.json({ features }, { status: 200 });
}

export async function POST(request: NextRequest) {
  const supabase = await createRouteSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { employee, error: empError, status: empStatus } = await requireActiveEmployee(supabase, user.id);
  if (!employee) return NextResponse.json({ error: empError }, { status: empStatus });

  // Fix (revisión 2026-07-30, punto 11): request.json() sin try/catch --
  // mismo patrón ya usado en src/app/api/admin/marketing/route.ts.
  let body: { featureType?: string; action?: string };
  try {
    body = await request.json();
  } catch (err) {
    return safeErrorResponse(err, 400, "JSON inválido");
  }
  const featureType = body.featureType;
  if (!featureType || !["day_in_life_reel", "public_badge_showcase"].includes(featureType)) {
    return NextResponse.json({ error: "featureType inválido" }, { status: 400 });
  }

  const { data: existing } = await supabase
    .from("employee_marketing_features")
    .select("id")
    .eq("employee_id", employee.id)
    .eq("feature_type", featureType)
    .is("deleted_at", null)
    .maybeSingle();

  const nowIso = new Date().toISOString();

  if (body.action === "consent") {
    if (existing) {
      const { error } = await supabase
        .from("employee_marketing_features")
        .update({ employee_consented_at: nowIso, employee_consent_withdrawn_at: null, updated_at: nowIso })
        .eq("id", existing.id);
      if (error) { console.error("Supabase query error:", error); return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 }); }
      return NextResponse.json({ ok: true }, { status: 200 });
    }
    const { data, error } = await supabase
      .from("employee_marketing_features")
      .insert({ employee_id: employee.id, feature_type: featureType, employee_consented_at: nowIso })
      .select()
      .single();
    if (error) { console.error("Supabase query error:", error); return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 }); }
    return NextResponse.json({ feature: data }, { status: 201 });
  }

  if (body.action === "withdraw") {
    if (!existing) {
      return NextResponse.json({ error: "No hay consentimiento registrado para retirar" }, { status: 404 });
    }
    const { error } = await supabase
      .from("employee_marketing_features")
      .update({ employee_consent_withdrawn_at: nowIso, updated_at: nowIso })
      .eq("id", existing.id);
    if (error) { console.error("Supabase query error:", error); return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 }); }
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  return NextResponse.json({ error: "Acción no reconocida" }, { status: 400 });
}

import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, logAdminAction } from "@/lib/admin";
import { evaluatePropertyRisk, type RiskFlagType } from "@/lib/property-risk";
import { safeErrorResponse } from "@/lib/api-errors";

// GET /api/admin/risk-assessments?propertyId=... — historial de evaluaciones de una propiedad
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("risk_assessments", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");

    let query = supabase
      .from("property_risk_assessments")
      .select("id, client_property_id, flags, flag_count, tier, hard_blocked, notes, created_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (propertyId) {
      query = query.eq("client_property_id", propertyId);
    }

    const { data, error } = await query.limit(100);

    if (error) {
      console.error("admin/risk-assessments error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json({ assessments: data || [] }, { status: 200 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

// POST /api/admin/risk-assessments — registrar evaluación de riesgo de una propiedad.
// v8.3 E7 (D.7.7): visible a admin y líder, NUNCA al cliente (regla explícita).
export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("risk_assessments", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const logResult = await logAdminAction({
    supabase, user: auth.user, roles: auth.roles,
    resource: "risk_assessments", method: request.method, path: request.url,
  });
  if (logResult.error) return NextResponse.json({ error: logResult.error }, { status: logResult.status });

  try {
    const body = await request.json();
    const { clientPropertyId, flags } = body as { clientPropertyId: string; flags: RiskFlagType[] };

    if (!clientPropertyId || !Array.isArray(flags)) {
      return NextResponse.json({ error: "Missing clientPropertyId or flags" }, { status: 400 });
    }

    // Fix (auditoría 2026-07-31, item 8): antes se insertaba directo y se
    // dependía de la FK (client_property_id REFERENCES client_properties,
    // migración 047 -- la tabla LEGACY del cotizador B2C, no la nueva
    // client_module_properties del Módulo de Cliente) para rechazar un id
    // inexistente. La integridad de datos ya estaba protegida por la FK,
    // pero el error que llegaba al admin era un 500 genérico ("Ocurrió un
    // error interno") en vez de un 404 claro. Se valida antes para dar un
    // error legible sin depender de interpretar el mensaje crudo de Postgres.
    const { data: property, error: propertyError } = await supabase
      .from("client_properties")
      .select("id")
      .eq("id", clientPropertyId)
      .is("deleted_at", null)
      .maybeSingle();
    if (propertyError) {
      console.error("admin/risk-assessments error:", propertyError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }
    if (!property) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 });
    }

    const assessment = evaluatePropertyRisk(flags);

    const { data: assessor } = await supabase
      .from("employees")
      .select("id")
      .eq("user_id", auth.user?.id)
      .single();

    const { data, error } = await supabase
      .from("property_risk_assessments")
      .insert({
        client_property_id: clientPropertyId,
        flags,
        flag_count: assessment.flagCount,
        tier: assessment.tier,
        hard_blocked: assessment.hardBlocked,
        notes: assessment.notes.join(" | "),
        assessed_by: assessor?.id || null,
      })
      .select()
      .single();

    if (error) {
      console.error("admin/risk-assessments error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json({ assessment: data, computed: assessment }, { status: 201 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

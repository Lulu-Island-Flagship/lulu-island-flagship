import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { evaluateEmployeeMarketingVisibility } from "@/lib/employee-marketing";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder";

function getSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        cookieStore.set({ name, value, ...options });
      },
      remove(name: string, options: CookieOptions) {
        cookieStore.set({ name, value: "", ...options });
      },
    },
  });
}

/**
 * v8.3 E10.8 — Consentimiento del empleado para marketing (reels "un día en
 * la vida" / insignias públicas en el sitio). El empleado solo puede ver y
 * modificar SUS propios registros (RLS lo impone también, esto es defensa
 * en profundidad).
 *
 * GET  /api/empleado/marketing-consent — mis features + visibilidad calculada.
 * POST /api/empleado/marketing-consent — { action: "consent" | "withdraw", featureType }
 *   "consent" crea el registro si no existe (o re-consiente si nunca hubo fila).
 */
export async function GET() {
  const supabase = getSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: employee } = await supabase.from("employees").select("id").eq("user_id", user.id).single();
  if (!employee) return NextResponse.json({ error: "Employee profile not found" }, { status: 403 });

  const { data, error } = await supabase
    .from("employee_marketing_features")
    .select("id, feature_type, employee_consented_at, employee_consent_withdrawn_at, admin_approved_at, asset_url")
    .eq("employee_id", employee.id)
    .is("deleted_at", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
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
  const supabase = getSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: employee } = await supabase.from("employees").select("id").eq("user_id", user.id).single();
  if (!employee) return NextResponse.json({ error: "Employee profile not found" }, { status: 403 });

  const body = await request.json();
  const featureType = body.featureType;
  if (!["day_in_life_reel", "public_badge_showcase"].includes(featureType)) {
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
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true }, { status: 200 });
    }
    const { data, error } = await supabase
      .from("employee_marketing_features")
      .insert({ employee_id: employee.id, feature_type: featureType, employee_consented_at: nowIso })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
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
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  return NextResponse.json({ error: "Acción no reconocida" }, { status: 400 });
}

import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { classifyWeatherException } from "@/lib/weather-exception";

/**
 * GET  /api/admin/weather-exceptions — bitácora de excepciones de clima adverso.
 * POST /api/admin/weather-exceptions — declara una excepción:
 *   { affectedDate, condition, alertLeadTimeHours?: number|null, affectedOrdersNote?, notes? }
 *
 * v8.3 E7 (D.10#10) — la resolución (reagendar sin penalización vs. aborto
 * seguro + Day Rate + 20% dcto) la calcula classifyWeatherException(), nunca
 * queda a discreción libre del admin. No toca `orders` ni dispatch (E4, en
 * construcción en otra sesión) — el reagendamiento real de cada orden es un
 * paso humano posterior fuera de esta ruta.
 *
 * Recurso RBAC: 'risk_assessments' (owner_admin + ops_coordinator) — misma
 * sensibilidad operativa de campo que la pre-evaluación de riesgo (migración
 * 047), y ya existe en admin-rbac.ts.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("risk_assessments", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { data, error } = await auth.supabase
    .from("weather_exceptions")
    .select(
      "id, affected_date, condition, source, alert_lead_time_hours, resolution, reschedule_discount_percent, affected_orders_note, notes, declared_by, created_at"
    )
    .is("deleted_at", null)
    .order("affected_date", { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ weatherExceptions: data || [] }, { status: 200 });
}

interface DeclareBody {
  affectedDate?: string;
  condition?: string;
  alertLeadTimeHours?: number | null;
  affectedOrdersNote?: string;
  notes?: string;
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("risk_assessments", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;

  let body: DeclareBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (!body.affectedDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.affectedDate)) {
    return NextResponse.json({ error: "affectedDate (YYYY-MM-DD) es obligatorio" }, { status: 400 });
  }
  if (!body.condition || body.condition.trim().length === 0) {
    return NextResponse.json({ error: "condition es obligatorio" }, { status: 400 });
  }
  const leadTime =
    body.alertLeadTimeHours === undefined || body.alertLeadTimeHours === null
      ? null
      : Number(body.alertLeadTimeHours);
  if (leadTime !== null && (Number.isNaN(leadTime) || leadTime < 0)) {
    return NextResponse.json({ error: "alertLeadTimeHours debe ser un número >= 0 o null" }, { status: 400 });
  }

  const decision = classifyWeatherException(leadTime);

  const { data: employeeRow } = await supabase
    .from("employees")
    .select("id")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  const { data, error } = await supabase
    .from("weather_exceptions")
    .insert({
      affected_date: body.affectedDate,
      condition: body.condition.trim(),
      source: "manual",
      alert_lead_time_hours: leadTime,
      resolution: decision.resolution,
      reschedule_discount_percent: decision.rescheduleDiscountPercent,
      affected_orders_note: body.affectedOrdersNote?.trim() || null,
      notes: body.notes?.trim() || null,
      declared_by: employeeRow?.id ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ weatherException: data, decision }, { status: 201 });
}

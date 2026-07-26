import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import {
  detectHheAdjustmentSuggestions,
  detectTeamSpeedSuggestions,
  type HheObservation,
  type TeamSpeedObservation,
} from "@/lib/hhe-adjustment";
import { sqftToRangeIndex, HHE_RANGE_LABELS } from "@/lib/hhe-sqft-band";
import { getVancouverTodayString } from "@/lib/date-utils";

// GET /api/admin/hhe-adjustments
//
// v8.3 E9 (D.9.2) — Sugerencias de ajuste de HHE. La lib pura
// (src/lib/hhe-adjustment.ts) ya existía, testeada, pero sin ninguna ruta
// que la disparara con datos reales. Esta ruta arma las observaciones
// (HHE estimada en el momento vs. HHE realmente consumida) y llama a
// detectHheAdjustmentSuggestions — nunca aplica el cambio ella sola
// (invariante B.3.2, un clic humano vía POST más abajo).
//
// LIMITACIÓN HONESTA declarada en el schema: no existe clock-in/out
// dedicado en la base. Se aproxima el tiempo real trabajado como el rango
// entre el primer y el último ítem de checklist marcado completado por
// orden (service_checklist_items.completed_at), multiplicado por el número
// de empleados asignados (assignments) para obtener horas-hombre reales —
// la misma unidad que hhe_settings.hhe_value. Es una aproximación razonable
// con la infraestructura existente, no un dato inventado: se documenta el
// método explícitamente para que el admin sepa qué está mirando.
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("hhe_settings", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;

  const { searchParams } = new URL(request.url);
  const asOfDate = searchParams.get("asOfDate") || getVancouverTodayString();
  // Ventana amplia (90 días) para tener suficiente muestra para la regla de
  // "sostenida 30 días" de detectHheAdjustmentSuggestions.
  const lookbackDate = new Date(`${asOfDate}T00:00:00Z`);
  lookbackDate.setUTCDate(lookbackDate.getUTCDate() - 90);
  const lookbackStr = lookbackDate.toISOString().slice(0, 10);

  const { data: orders, error: ordersError } = await supabase
    .from("orders")
    .select("id, service_date, quotes(service_type, square_feet)")
    .eq("status", "completed")
    .gte("service_date", lookbackStr)
    .lte("service_date", asOfDate);
  if (ordersError) {
    console.error("admin/hhe-adjustments error:", ordersError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  const orderIds = (orders || []).map((o) => o.id);
  if (orderIds.length === 0) {
    return NextResponse.json({ suggestions: [], rangeLabels: HHE_RANGE_LABELS, observationsUsed: 0 }, { status: 200 });
  }

  const [{ data: checklistRows, error: checklistError }, { data: assignmentRows, error: assignmentError }, { data: hheTable, error: hheError }] =
    await Promise.all([
      supabase
        .from("service_checklist_items")
        .select("order_id, completed_at")
        .in("order_id", orderIds)
        .not("completed_at", "is", null),
      supabase.from("assignments").select("order_id, employee_id, employees(name)").in("order_id", orderIds),
      supabase.rpc("get_current_hhe_table"),
    ]);
  if (checklistError) {
    console.error("admin/hhe-adjustments error:", checklistError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }
  if (assignmentError) {
    console.error("admin/hhe-adjustments error:", assignmentError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }
  if (hheError) {
    console.error("admin/hhe-adjustments error:", hheError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  const baselineTable = new Map<string, number>(); // "service_type::range_index" -> hhe_value
  for (const row of hheTable || []) {
    baselineTable.set(`${row.service_type}::${row.range_index}`, Number(row.hhe_value));
  }

  const timestampsByOrder = new Map<string, string[]>();
  for (const c of checklistRows || []) {
    const list = timestampsByOrder.get(c.order_id) ?? [];
    list.push(c.completed_at as string);
    timestampsByOrder.set(c.order_id, list);
  }

  const teamSizeByOrder = new Map<string, number>();
  type EmpJoin = { name: string } | { name: string }[] | null;
  const teamLabelByOrder = new Map<string, string>();
  for (const a of assignmentRows || []) {
    const set = teamSizeByOrder.get(a.order_id) ?? 0;
    teamSizeByOrder.set(a.order_id, set + 1);

    const empJoin = a.employees as EmpJoin;
    const emp = Array.isArray(empJoin) ? empJoin[0] : empJoin;
    const name = emp?.name || "(sin asignar)";
    const existingLabel = teamLabelByOrder.get(a.order_id);
    teamLabelByOrder.set(a.order_id, existingLabel ? `${existingLabel} + ${name}` : name);
  }
  // Nota: cuenta filas de assignments (una por empleado asignado), no distinct — si hubiera
  // duplicados por reasignación se sobreestimaría levemente el N. Aceptable para una sugerencia
  // que de todos modos exige aprobación humana explícita.

  type QuoteJoin = { service_type: string; square_feet: number } | { service_type: string; square_feet: number }[] | null;
  const observations: HheObservation[] = [];
  const teamObservations: TeamSpeedObservation[] = [];
  for (const o of orders || []) {
    const quoteJoin = o.quotes as QuoteJoin;
    const quote = Array.isArray(quoteJoin) ? quoteJoin[0] : quoteJoin;
    if (!quote) continue;

    const timestamps = timestampsByOrder.get(o.id);
    if (!timestamps || timestamps.length < 2) continue; // sin al menos 2 marcas no hay rango que medir

    const sorted = timestamps.slice().sort();
    const elapsedHours = (new Date(sorted[sorted.length - 1]).getTime() - new Date(sorted[0]).getTime()) / 3_600_000;
    if (elapsedHours <= 0) continue;

    const teamSize = teamSizeByOrder.get(o.id) || 1;
    const actualHhe = elapsedHours * teamSize;

    const rangeIndex = sqftToRangeIndex(quote.square_feet);
    const baselineHhe = baselineTable.get(`${quote.service_type}::${rangeIndex}`);
    if (!baselineHhe) continue;

    observations.push({
      serviceType: quote.service_type,
      sqftBand: String(rangeIndex),
      date: o.service_date,
      baselineHhe,
      actualHhe,
    });

    // v8.3 E9.2 "equipo 20% más rápido consistente": misma fuente de datos,
    // vista desde el ángulo del EQUIPO en lugar del tipo de servicio.
    // estimatedHours = horas-hombre esperadas repartidas entre el N real
    // asignado (el "tiempo de bloqueo" esperado para ESE equipo), actualHours
    // = tiempo real transcurrido (elapsedHours, sin multiplicar por N).
    const teamLabel = teamLabelByOrder.get(o.id);
    if (teamLabel) {
      teamObservations.push({
        teamLabel,
        date: o.service_date,
        estimatedHours: baselineHhe / teamSize,
        actualHours: elapsedHours,
      });
    }
  }

  const suggestions = detectHheAdjustmentSuggestions(observations, asOfDate);
  const teamSpeedSuggestions = detectTeamSpeedSuggestions(teamObservations, asOfDate);

  return NextResponse.json(
    {
      suggestions: suggestions.map((s) => ({ ...s, sqftBandLabel: HHE_RANGE_LABELS[Number(s.sqftBand)] ?? s.sqftBand })),
      teamSpeedSuggestions,
      rangeLabels: HHE_RANGE_LABELS,
      observationsUsed: observations.length,
    },
    { status: 200 }
  );
}

// POST /api/admin/hhe-adjustments — aprueba UNA sugerencia con un clic
// (invariante B.3.2). Cierra la celda vigente en hhe_settings e inserta la
// nueva, mismo patrón que PATCH /api/admin/hhe-settings. Al ser un UPDATE
// sobre hhe_settings (cerrar effective_to), dispara el trigger genérico de
// config_snapshots (migración 042, hhe_settings ya está en la whitelist) —
// el registro y el Deshacer quedan cubiertos por /admin/config-history sin
// código adicional (invariante B.2.10, patrón snapshot/undo reutilizado).
export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("hhe_settings", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase, user } = auth;

  let body: { serviceType?: string; rangeIndex?: number; suggestedHhe?: number; impactPercent?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { serviceType, rangeIndex, suggestedHhe, impactPercent } = body;
  if (!serviceType || rangeIndex === undefined || suggestedHhe === undefined) {
    return NextResponse.json({ error: "serviceType, rangeIndex y suggestedHhe son requeridos" }, { status: 400 });
  }
  if (rangeIndex < 0 || rangeIndex > 4) {
    return NextResponse.json({ error: "rangeIndex debe estar entre 0 y 4" }, { status: 400 });
  }
  if (suggestedHhe <= 0) {
    return NextResponse.json({ error: "suggestedHhe debe ser positivo" }, { status: 400 });
  }

  const today = getVancouverTodayString();
  const reason = `Ajuste automático de HHE aprobado por admin (D.9.2): desviación sostenida ${
    impactPercent !== undefined ? `${impactPercent >= 0 ? "+" : ""}${impactPercent}%` : ""
  }`;

  const { error: closeError } = await supabase
    .from("hhe_settings")
    .update({ effective_to: today, updated_at: new Date().toISOString() })
    .eq("service_type", serviceType)
    .eq("range_index", rangeIndex)
    .is("effective_to", null);
  if (closeError) {
    console.error("admin/hhe-adjustments error:", closeError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  const { data: inserted, error: insertError } = await supabase
    .from("hhe_settings")
    .insert({
      service_type: serviceType,
      range_index: rangeIndex,
      hhe_value: suggestedHhe,
      effective_from: today,
      reason,
      created_by: user.id,
    })
    .select()
    .single();
  if (insertError) {
    console.error("admin/hhe-adjustments error:", insertError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  return NextResponse.json({ applied: inserted }, { status: 200 });
}

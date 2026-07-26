import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import {
  summarizeByZone,
  summarizeByServiceType,
  summarizeByTeam,
  summarizeOverall,
  computeProratedFixedCostsPerOrder,
  type OrderFinancialRecord,
} from "@/lib/operational-accounting";

// GET /api/admin/accounting?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// v8.3 E9 (D.9) — panel de contabilidad operativa: cobrado/pagado/margen de
// contribución/margen neto real, por zona/servicio/equipo. "Cobrado" es el
// monto real capturado (chargeback_reserves.captured_amount), no el subtotal
// cotizado. "Pagado" es el bruto de nómina (payroll_entries.gross_amount).
// La carga patronal (CPP/EI/WorkSafeBC) se suma desde payroll_cycle_deductions
// si ya existe un snapshot para ese ciclo; si no, queda en 0 (no se inventa).
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("finance", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  let ordersQuery = supabase
    .from("orders")
    .select("id, quote_id, service_date, total_paid_cents, quotes(zone, service_type)")
    .eq("status", "completed");
  if (from) ordersQuery = ordersQuery.gte("service_date", from);
  if (to) ordersQuery = ordersQuery.lte("service_date", to);

  const { data: orders, error: ordersError } = await ordersQuery;
  if (ordersError) {
    console.error("admin/accounting error:", ordersError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  const orderIds = (orders || []).map((o) => o.id);
  if (orderIds.length === 0) {
    const empty: OrderFinancialRecord[] = [];
    return NextResponse.json({
      byZone: summarizeByZone(empty),
      byServiceType: summarizeByServiceType(empty),
      byTeam: summarizeByTeam(empty),
      overall: summarizeOverall(empty),
      fixedCostsConfigured: false,
      monthlyFixedCostsCents: 0,
    });
  }

  const [{ data: reserves }, { data: payrollEntries }, { data: assignments }, { data: fixedCostsCents }] = await Promise.all([
    supabase.from("chargeback_reserves").select("order_id, captured_amount").in("order_id", orderIds),
    supabase.from("payroll_entries").select("order_id, employee_id, gross_amount").in("order_id", orderIds).is("deleted_at", null),
    supabase.from("assignments").select("order_id, employee_id, employees(name)").in("order_id", orderIds),
    supabase.rpc("get_current_monthly_fixed_costs_cents"),
  ]);

  // v8.3 E9.1: "margen neto real" exige prorratear costos fijos mensuales
  // (renta, seguros, software, compensación del dueño -- fixed_costs_settings,
  // migración 134). Si el dueño nunca lo configuró (sigue en el seed $0),
  // esto queda en $0 explícitamente -- nunca se simula un número que no
  // existe. Lógica pura y testeada en src/lib/operational-accounting.ts.
  const monthlyFixedCostsCents = Number(fixedCostsCents || 0);
  const otherCostsPerOrderCents = computeProratedFixedCostsPerOrder(
    monthlyFixedCostsCents,
    (orders || []).map((o) => String(o.service_date))
  );

  // B-P3-1 fix (auditoría 2026-07-21): "cobrado" se derivaba solo de
  // chargeback_reserves.captured_amount, que únicamente se puebla si el
  // flag chargeback_reserve_enabled está encendido (apagado por defecto,
  // migración 024). Con la configuración default, el panel reportaba $0
  // de ingresos con órdenes completadas y cobradas de verdad.
  // orders.total_paid_cents (RAÍZ-3, migración 229: ya en centavos) se
  // escribe siempre por las rutas de captura (hold, batch-capture,
  // capture-remainder, cancel, no-show) independientemente del flag, así
  // que es la fuente primaria confiable; chargeback_reserves se usa solo
  // como refinamiento cuando el flag SÍ está activo y da un dato más
  // preciso a nivel de captured_amount real de Stripe.
  const reserveCapturedByOrder = new Map<string, number>();
  for (const r of reserves || []) {
    reserveCapturedByOrder.set(r.order_id, (reserveCapturedByOrder.get(r.order_id) || 0) + r.captured_amount);
  }

  const collectedByOrder = new Map<string, number>();
  for (const o of orders || []) {
    const reserveCaptured = reserveCapturedByOrder.get(o.id);
    const totalPaidCents = Math.round(Number(o.total_paid_cents ?? 0));
    collectedByOrder.set(o.id, reserveCaptured !== undefined ? reserveCaptured : totalPaidCents);
  }

  const laborByOrder = new Map<string, number>();
  for (const p of payrollEntries || []) {
    laborByOrder.set(p.order_id, (laborByOrder.get(p.order_id) || 0) + p.gross_amount);
  }

  type EmpJoin = { name: string } | { name: string }[] | null;
  const teamByOrder = new Map<string, string>();
  for (const a of assignments || []) {
    const empJoin = a.employees as EmpJoin;
    const emp = Array.isArray(empJoin) ? empJoin[0] : empJoin;
    const name = emp?.name || "(sin asignar)";
    const existing = teamByOrder.get(a.order_id);
    teamByOrder.set(a.order_id, existing ? `${existing} + ${name}` : name);
  }

  type QuoteJoin = { zone: string; service_type: string } | { zone: string; service_type: string }[] | null;
  const records: OrderFinancialRecord[] = (orders || []).map((o) => {
    const quoteJoin = o.quotes as QuoteJoin;
    const quote = Array.isArray(quoteJoin) ? quoteJoin[0] : quoteJoin;
    return {
      orderId: o.id,
      zone: quote?.zone || "(sin zona)",
      serviceType: quote?.service_type || "(sin tipo)",
      teamLabel: teamByOrder.get(o.id) || "(sin asignar)",
      collectedCents: collectedByOrder.get(o.id) || 0,
      laborCostCents: laborByOrder.get(o.id) || 0,
      // NO ARREGLADO (auditoría 2026-07-21, B-P3-1, mitad no cerrada): sigue
      // en 0 a propósito -- payroll_cycle_deductions (052) es un snapshot
      // por (employee_id, cycle_label), no por orden, y payroll_entries no
      // tiene ninguna ruta que la puebla (hallazgo de dominio D, fuera del
      // alcance de este archivo). Prorratear la carga patronal por orden
      // requeriría esa tabla poblada más una regla de reparto por orden que
      // no existe hoy. Se deja en 0 explícito en vez de inventar un número.
      employerBurdenCents: 0,
      otherCostsCents: otherCostsPerOrderCents,
    };
  });

  return NextResponse.json({
    byZone: summarizeByZone(records),
    byServiceType: summarizeByServiceType(records),
    byTeam: summarizeByTeam(records),
    overall: summarizeOverall(records),
    fixedCostsConfigured: monthlyFixedCostsCents > 0,
    monthlyFixedCostsCents,
  });
}

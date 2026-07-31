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
import { getCycleForDate } from "@/lib/payroll-cycle";
import { calculatePayrollDeductions } from "@/lib/payroll-deductions";

// GET /api/admin/accounting?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// v8.3 E9 (D.9) — panel de contabilidad operativa: cobrado/pagado/margen de
// contribución/margen neto real, por zona/servicio/equipo. "Cobrado" es el
// monto real capturado (chargeback_reserves.captured_amount), no el subtotal
// cotizado. "Pagado" es el bruto de nómina (payroll_entries.gross_amount).
// La carga patronal (CPP/EI/WorkSafeBC) se suma desde payroll_cycle_deductions
// si ya existe un snapshot para ese ciclo; si no, se usa una estimación de
// respaldo (mismas tasas reales de payroll-deductions.ts) marcada como
// employerBurdenIsEstimated/isEstimated en la respuesta (bug #3, auditoría
// 2026-07-30) -- ya no se muestra $0 silenciosamente.
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
    supabase
      .from("payroll_entries")
      .select("order_id, employee_id, gross_amount, created_at")
      .in("order_id", orderIds)
      .is("deleted_at", null),
    supabase.from("assignments").select("order_id, employee_id, employees(name)").in("order_id", orderIds),
    supabase.rpc("get_current_monthly_fixed_costs_cents"),
  ]);

  // v8.3 E9.1: "margen neto real" exige prorratear costos fijos mensuales
  // (renta, seguros, software, compensación del dueño -- fixed_costs_settings,
  // migración 134). Si el dueño nunca lo configuró (sigue en el seed $0),
  // esto queda en $0 explícitamente -- nunca se simula un número que no
  // existe. Lógica pura y testeada en src/lib/operational-accounting.ts.
  const monthlyFixedCostsCents = Number(fixedCostsCents || 0);
  // Fix (auditoría 2026-07-30): computeProratedFixedCostsPerOrder ahora
  // devuelve un array (uno por orden, mismo índice que `orders`) en vez de
  // un escalar aplicado a todas por igual -- así el resto de centavos que
  // no divide exacto se reparte entre las primeras órdenes en vez de
  // perderse (o inventarse) al multiplicar de vuelta por N.
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

  // v8.3 fix (carga patronal por orden, antes B-P3-1 "no arreglado"):
  // payroll_cycle_deductions (052) es un snapshot por (employee_id,
  // cycle_label), no por orden -- pero SÍ trae employer_cost_cents (CPP+CPP2
  // patronal + EI patronal + WorkSafeBC, ver payroll-deductions.ts) y
  // gross_cents (el bruto total de ese empleado en ese ciclo) ya calculados
  // por el export de nómina. Con eso se puede prorratear sin inventar nada:
  // cada entrada de payroll_entries de esta orden recibe la fracción de la
  // carga patronal del ciclo proporcional a lo que esa entrada representa
  // del bruto total del empleado en ese ciclo. Se agrupa por created_at
  // (mismo criterio de ciclo que usa payroll-export.ts) porque es el campo
  // que existe en payroll_entries -- service_date de la orden puede caer en
  // un ciclo distinto si el pago se registró después.
  //
  // Si el ciclo de un empleado nunca se exportó (no hay fila en
  // payroll_cycle_deductions todavía), esa porción queda en 0 -- igual que
  // antes, nunca se inventa un número para un ciclo sin snapshot.
  const employeeCycleKeys = new Set<string>();
  const cycleLabelByEmployeeAndOrder = new Map<string, string>();
  for (const p of payrollEntries || []) {
    const cycleLabel = getCycleForDate(String(p.created_at).slice(0, 10)).label;
    employeeCycleKeys.add(`${p.employee_id}|${cycleLabel}`);
    cycleLabelByEmployeeAndOrder.set(`${p.order_id}|${p.employee_id}`, cycleLabel);
  }

  const employeeIdsForBurden = Array.from(new Set((payrollEntries || []).map((p) => p.employee_id)));
  const cycleLabelsForBurden = Array.from(new Set(Array.from(employeeCycleKeys).map((k) => k.split("|")[1])));

  const cycleDeductionsByEmployeeCycle = new Map<string, { grossCents: number; employerCostCents: number }>();
  if (employeeIdsForBurden.length > 0 && cycleLabelsForBurden.length > 0) {
    const { data: cycleDeductions } = await supabase
      .from("payroll_cycle_deductions")
      .select("employee_id, cycle_label, gross_cents, employer_cost_cents")
      .in("employee_id", employeeIdsForBurden)
      .in("cycle_label", cycleLabelsForBurden);

    for (const d of cycleDeductions || []) {
      cycleDeductionsByEmployeeCycle.set(`${d.employee_id}|${d.cycle_label}`, {
        grossCents: d.gross_cents,
        employerCostCents: d.employer_cost_cents,
      });
    }
  }

  const employerBurdenByOrder = new Map<string, number>();
  // Fix (auditoría 2026-07-30, bug #3): antes, sin snapshot en
  // payroll_cycle_deductions (ciclo del empleado aún no exportado/cerrado),
  // la carga patronal de esa entrada se dejaba en $0 silenciosamente --
  // hacía ver el margen neto artificialmente alto en reportes de mitad de
  // ciclo. Ahora se calcula una ESTIMACIÓN de respaldo con las mismas tasas
  // reales CPP/CPP2/EI/WorkSafeBC de payroll-deductions.ts (sin YTD, porque
  // no lo tenemos fuera de un ciclo cerrado -- aproximación, no una cifra
  // inventada) y la orden se marca en `employerBurdenEstimatedOrders` para
  // que la API y la UI la etiqueten explícitamente como "estimado/proyectado".
  const employerBurdenEstimatedOrders = new Set<string>();
  for (const p of payrollEntries || []) {
    const cycleLabel = cycleLabelByEmployeeAndOrder.get(`${p.order_id}|${p.employee_id}`);
    const snapshot = cycleLabel ? cycleDeductionsByEmployeeCycle.get(`${p.employee_id}|${cycleLabel}`) : undefined;
    if (!snapshot || snapshot.grossCents <= 0) {
      const estimate = calculatePayrollDeductions({
        grossCents: p.gross_amount,
        yearsOfService: 0,
        ytdPensionableCents: 0,
        ytdInsurableCents: 0,
        ytdAssessableCents: 0,
      });
      employerBurdenByOrder.set(
        p.order_id,
        (employerBurdenByOrder.get(p.order_id) || 0) + estimate.employerCostCents
      );
      employerBurdenEstimatedOrders.add(p.order_id);
      continue;
    }
    const shareCents = Math.round((p.gross_amount / snapshot.grossCents) * snapshot.employerCostCents);
    employerBurdenByOrder.set(p.order_id, (employerBurdenByOrder.get(p.order_id) || 0) + shareCents);
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
  const records: OrderFinancialRecord[] = (orders || []).map((o, i) => {
    const quoteJoin = o.quotes as QuoteJoin;
    const quote = Array.isArray(quoteJoin) ? quoteJoin[0] : quoteJoin;
    return {
      orderId: o.id,
      zone: quote?.zone || "(sin zona)",
      serviceType: quote?.service_type || "(sin tipo)",
      teamLabel: teamByOrder.get(o.id) || "(sin asignar)",
      collectedCents: collectedByOrder.get(o.id) || 0,
      laborCostCents: laborByOrder.get(o.id) || 0,
      // ARREGLADO (ver bloque employerBurdenByOrder arriba): prorrateado
      // desde payroll_cycle_deductions.employer_cost_cents proporcional al
      // bruto de cada entrada de nómina dentro de su ciclo. Si el ciclo de
      // nómina del empleado aún no se exportó (sin snapshot todavía), se usa
      // una estimación de respaldo (ver employerBurdenEstimatedOrders) en
      // vez de $0 -- employerBurdenIsEstimated distingue ambos casos.
      employerBurdenCents: employerBurdenByOrder.get(o.id) || 0,
      employerBurdenIsEstimated: employerBurdenEstimatedOrders.has(o.id),
      // Fix (auditoría 2026-07-30): índice por orden, no el mismo monto
      // repetido -- ver computeProratedFixedCostsPerOrder.
      otherCostsCents: otherCostsPerOrderCents[i] ?? 0,
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

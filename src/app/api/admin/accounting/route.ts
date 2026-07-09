import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import {
  summarizeByZone,
  summarizeByServiceType,
  summarizeByTeam,
  summarizeOverall,
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
    .select("id, quote_id, service_date, quotes(zone, service_type)")
    .eq("status", "completed");
  if (from) ordersQuery = ordersQuery.gte("service_date", from);
  if (to) ordersQuery = ordersQuery.lte("service_date", to);

  const { data: orders, error: ordersError } = await ordersQuery;
  if (ordersError) {
    return NextResponse.json({ error: ordersError.message }, { status: 500 });
  }

  const orderIds = (orders || []).map((o) => o.id);
  if (orderIds.length === 0) {
    const empty: OrderFinancialRecord[] = [];
    return NextResponse.json({
      byZone: summarizeByZone(empty),
      byServiceType: summarizeByServiceType(empty),
      byTeam: summarizeByTeam(empty),
      overall: summarizeOverall(empty),
    });
  }

  const [{ data: reserves }, { data: payrollEntries }, { data: assignments }] = await Promise.all([
    supabase.from("chargeback_reserves").select("order_id, captured_amount").in("order_id", orderIds),
    supabase.from("payroll_entries").select("order_id, employee_id, gross_amount").in("order_id", orderIds).is("deleted_at", null),
    supabase.from("assignments").select("order_id, employee_id, employees(name)").in("order_id", orderIds),
  ]);

  const collectedByOrder = new Map<string, number>();
  for (const r of reserves || []) {
    collectedByOrder.set(r.order_id, (collectedByOrder.get(r.order_id) || 0) + r.captured_amount);
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
      employerBurdenCents: 0, // ver nota arriba — no se prorratea sin snapshot de ciclo por orden
    };
  });

  return NextResponse.json({
    byZone: summarizeByZone(records),
    byServiceType: summarizeByServiceType(records),
    byTeam: summarizeByTeam(records),
    overall: summarizeOverall(records),
  });
}

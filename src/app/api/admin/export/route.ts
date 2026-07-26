import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import {
  buildUniversalExportJson,
  buildUniversalExportCsv,
  type UniversalExportRecord,
} from "@/lib/universal-export";

// GET /api/admin/export?month=YYYY-MM&format=csv|json
//
// v8.3 E9 (D.9.5) — Exportación universal mensual. La lib pura
// (src/lib/universal-export.ts) ya existía, testeada, pero sin ninguna ruta
// que la disparara. Esta ruta arma los UniversalExportRecord[] del mes desde
// las fuentes YA CONSTRUIDAS y las pasa a buildUniversalExportJson/Csv.
//
// Fuentes usadas (todas reales, ninguna inventada):
//   revenue          -> orders.total_paid_cents (primario), con
//                        chargeback_reserves.captured_amount como override
//                        cuando existe registro para la orden (ver fix
//                        B-P3-EXPORT, auditoría externa 2026-07-24, más abajo)
//   payroll_gross    -> payroll_entries.gross_amount + payroll_readiness_credits.day_rate_cents
//   payroll_deduction-> payroll_cycle_deductions: cpp + cpp2 + ei_employee (retenido al empleado)
//   employer_burden  -> payroll_cycle_deductions: ei_employer + worksafebc_employer + vacation_pay_accrual
//   retention_gift   -> retention_gifts.suggested_gift_cents
//   tax_reserve      -> cash_tax_reserve_ledger.tax_reserve_cents
//
// NO incluye partner_commission: no existe todavía ninguna tabla de
// comisiones a partners (esa pieza es E10, no construida). La categoría
// existe en el schema (UniversalExportCategory) para cuando se construya —
// no se inventa un monto de 0 falso, simplemente no aparece ningún registro
// de esa categoría este mes.
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("finance", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;

  const { searchParams } = new URL(request.url);
  const month = searchParams.get("month") || new Date().toISOString().slice(0, 7); // YYYY-MM
  const format = searchParams.get("format") || "json";

  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "month debe tener formato YYYY-MM" }, { status: 400 });
  }

  const [year, monthNum] = month.split("-").map(Number);
  const rangeStart = `${month}-01`;
  const lastDay = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
  const rangeEnd = `${month}-${String(lastDay).padStart(2, "0")}`;

  const records: UniversalExportRecord[] = [];

  // ------------------------------------------------------------
  // revenue: cobrado real por orden, con service_date en el mes.
  //
  // Fix B-P3-EXPORT (auditoría externa 2026-07-24): esta ruta leía
  // EXCLUSIVAMENTE chargeback_reserves.captured_amount, sin fallback.
  // chargeback_reserve_enabled está apagado por defecto (feature_flags,
  // migración 024/081) y con el flag apagado chargeback_reserves NUNCA se
  // puebla (ver accounting/route.ts líneas ~77-97), así que este reporte
  // mostraba $0 de revenue para meses con órdenes cobradas de verdad,
  // mientras accounting/route.ts, client-segments/route.ts y
  // experiments/[id]/assign/route.ts sí mostraban el número real leyendo
  // orders.total_paid_cents. Replicamos aquí la MISMA jerarquía ya probada
  // en accounting/route.ts: orders.total_paid_cents (RAÍZ-3, migración 229,
  // ya en centavos; se escribe siempre por las rutas de captura sin
  // depender del flag) es la fuente primaria, y
  // chargeback_reserves.captured_amount se usa solo como override cuando
  // existe un registro para esa orden (flag activo y sí se pobló), porque
  // da un dato más preciso a nivel de captured_amount real de Stripe.
  const { data: revenueOrders, error: revenueOrdersError } = await supabase
    .from("orders")
    .select("id, service_date, total_paid_cents")
    .eq("status", "completed")
    .gte("service_date", rangeStart)
    .lte("service_date", rangeEnd);
  if (revenueOrdersError) {
    console.error("admin/export error:", revenueOrdersError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  const revenueOrderIds = (revenueOrders || []).map((o) => o.id);
  const reserveCapturedByOrderId = new Map<string, number>();
  if (revenueOrderIds.length > 0) {
    const { data: reserveRows, error: reserveError } = await supabase
      .from("chargeback_reserves")
      .select("order_id, captured_amount")
      .in("order_id", revenueOrderIds);
    if (reserveError) {
      console.error("admin/export error:", reserveError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }
    for (const r of reserveRows || []) {
      reserveCapturedByOrderId.set(
        r.order_id,
        (reserveCapturedByOrderId.get(r.order_id) || 0) + r.captured_amount
      );
    }
  }

  for (const o of revenueOrders || []) {
    const reserveCaptured = reserveCapturedByOrderId.get(o.id);
    const totalPaidCents = Math.round(Number(o.total_paid_cents ?? 0));
    const amountCents = reserveCaptured !== undefined ? reserveCaptured : totalPaidCents;
    records.push({
      category: "revenue",
      description: `Cobrado orden ${o.id}`,
      amountCents,
      date: o.service_date || rangeStart,
      metadata: { order_id: o.id },
    });
  }

  // ------------------------------------------------------------
  // payroll_gross: nómina bruta por servicio + créditos de Day Rate (readiness)
  // ------------------------------------------------------------
  const { data: payrollRows, error: payrollError } = await supabase
    .from("payroll_entries")
    .select("employee_id, order_id, gross_amount, created_at, employees(name)")
    .gte("created_at", rangeStart)
    .lte("created_at", `${rangeEnd}T23:59:59`)
    .is("deleted_at", null);
  if (payrollError) {
    console.error("admin/export error:", payrollError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  type EmpJoin = { name: string } | { name: string }[] | null;
  for (const p of payrollRows || []) {
    const empJoin = p.employees as EmpJoin;
    const emp = Array.isArray(empJoin) ? empJoin[0] : empJoin;
    records.push({
      category: "payroll_gross",
      description: `Nómina bruta ${emp?.name || p.employee_id} — orden ${p.order_id}`,
      amountCents: p.gross_amount,
      date: String(p.created_at).slice(0, 10),
      metadata: { employee_id: p.employee_id, order_id: p.order_id },
    });
  }

  const { data: readinessRows, error: readinessError } = await supabase
    .from("payroll_readiness_credits")
    .select("employee_id, day_rate_cents, credit_date, employees(name)")
    .gte("credit_date", rangeStart)
    .lte("credit_date", rangeEnd)
    .is("deleted_at", null);
  if (readinessError) {
    console.error("admin/export error:", readinessError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  for (const c of readinessRows || []) {
    const empJoin = c.employees as EmpJoin;
    const emp = Array.isArray(empJoin) ? empJoin[0] : empJoin;
    records.push({
      category: "payroll_gross",
      description: `Crédito Day Rate (modo "No estoy listo") ${emp?.name || c.employee_id}`,
      amountCents: c.day_rate_cents,
      date: c.credit_date,
      metadata: { employee_id: c.employee_id },
    });
  }

  // ------------------------------------------------------------
  // payroll_deduction / employer_burden: desglose del ciclo quincenal
  // ------------------------------------------------------------
  const { data: deductionRows, error: deductionError } = await supabase
    .from("payroll_cycle_deductions")
    .select(
      "employee_id, cycle_label, cpp_cents, cpp2_cents, ei_employee_cents, ei_employer_cents, worksafebc_employer_cents, vacation_pay_accrual_cents, created_at, employees(name)"
    )
    .like("cycle_label", `${month}%`);
  if (deductionError) {
    console.error("admin/export error:", deductionError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  for (const d of deductionRows || []) {
    const empJoin = d.employees as EmpJoin;
    const emp = Array.isArray(empJoin) ? empJoin[0] : empJoin;
    const empName = emp?.name || d.employee_id;
    const date = String(d.created_at).slice(0, 10);
    const employeeDeductions = d.cpp_cents + d.cpp2_cents + d.ei_employee_cents;
    if (employeeDeductions > 0) {
      records.push({
        category: "payroll_deduction",
        description: `CPP+CPP2+EI retenido — ${empName} (${d.cycle_label})`,
        amountCents: employeeDeductions,
        date,
        metadata: { employee_id: d.employee_id, cycle_label: d.cycle_label },
      });
    }
    const burden = d.ei_employer_cents + d.worksafebc_employer_cents + d.vacation_pay_accrual_cents;
    if (burden > 0) {
      records.push({
        category: "employer_burden",
        description: `EI patronal + WorkSafeBC + Vacation Pay — ${empName} (${d.cycle_label})`,
        amountCents: burden,
        date,
        metadata: { employee_id: d.employee_id, cycle_label: d.cycle_label },
      });
    }
  }

  // ------------------------------------------------------------
  // retention_gift
  // ------------------------------------------------------------
  const { data: giftRows, error: giftError } = await supabase
    .from("retention_gifts")
    .select("client_user_id, tier, suggested_gift_cents, created_at, requires_manual_approval, approved_at")
    .gte("created_at", rangeStart)
    .lte("created_at", `${rangeEnd}T23:59:59`)
    .is("deleted_at", null);
  if (giftError) {
    console.error("admin/export error:", giftError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  for (const g of giftRows || []) {
    records.push({
      category: "retention_gift",
      description: `Regalo de retención ${g.tier} — cliente ${g.client_user_id}`,
      amountCents: g.suggested_gift_cents,
      date: String(g.created_at).slice(0, 10),
      metadata: {
        client_user_id: g.client_user_id,
        requires_manual_approval: String(g.requires_manual_approval),
        approved: String(Boolean(g.approved_at)),
      },
    });
  }

  // ------------------------------------------------------------
  // tax_reserve
  // ------------------------------------------------------------
  const { data: reserveRows, error: reserveErr } = await supabase
    .from("cash_tax_reserve_ledger")
    .select("order_id, tax_reserve_cents, created_at")
    .gte("created_at", rangeStart)
    .lte("created_at", `${rangeEnd}T23:59:59`);
  if (reserveErr) {
    console.error("admin/export error:", reserveErr);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  for (const t of reserveRows || []) {
    records.push({
      category: "tax_reserve",
      description: `Reserva de impuestos GST+PST 12% — orden ${t.order_id}`,
      amountCents: t.tax_reserve_cents,
      date: String(t.created_at).slice(0, 10),
      metadata: { order_id: t.order_id },
    });
  }

  const generatedAtIso = new Date().toISOString();

  if (format === "csv") {
    const csv = buildUniversalExportCsv(records, month);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="export_universal_${month}.csv"`,
      },
    });
  }

  const doc = buildUniversalExportJson(records, month, generatedAtIso);
  return NextResponse.json(doc, { status: 200 });
}

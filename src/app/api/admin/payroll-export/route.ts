import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { getCycleForDate, getPreviousCycle, aggregateCycle, type CycleEntry } from "@/lib/payroll-cycle";
import { buildCycleDeductions, cycleDeductionsToCsv, totalCycleDeductions } from "@/lib/payroll-export";
import { getVancouverTodayString } from "@/lib/date-utils";

// GET /api/admin/payroll-export?date=YYYY-MM-DD&format=csv|json&cycle=current|previous
//
// v8.3 E9 (D.9) — nómina completa exportable con desglose CPP/CPP2/EI/
// WorkSafeBC/Vacation Pay por empleado. Actualiza payroll_ytd al final para
// que el siguiente ciclo del año siga prorrateando los topes correctamente.
//
// LIMITACIÓN EXPLÍCITA: no incluye retención de impuesto federal/provincial
// (income tax) — ver nota en payroll-deductions.ts. estimated_net_cad es un
// neto aproximado, no el neto oficial de nómina.
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("payroll", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get("date") || getVancouverTodayString();
  const format = searchParams.get("format") || "json";
  const which = searchParams.get("cycle") || "previous"; // por defecto: el ciclo que toca pagar

  const cycle = which === "current" ? getCycleForDate(dateParam) : getPreviousCycle(dateParam);
  const calendarYear = Number(cycle.start.slice(0, 4));

  const { data: entries, error: entriesError } = await supabase
    .from("payroll_entries")
    .select("employee_id, gross_amount, base_amount, qc_bonus_amount, qc_penalty_amount, rework_amount, minimum_wage_adjustment, created_at, employees(name, hire_date)")
    .gte("created_at", cycle.start)
    .lte("created_at", `${cycle.end}T23:59:59`)
    .is("deleted_at", null);

  if (entriesError) {
    return NextResponse.json({ error: entriesError.message }, { status: 500 });
  }

  type EmployeeJoin = { name: string; hire_date: string | null } | { name: string; hire_date: string | null }[] | null;
  const cycleEntries: CycleEntry[] = (entries || []).map((e) => {
    const empJoin = e.employees as EmployeeJoin;
    const emp = Array.isArray(empJoin) ? empJoin[0] : empJoin;
    return {
      employeeId: e.employee_id,
      employeeName: emp?.name || "(sin nombre)",
      serviceDate: String(e.created_at).slice(0, 10),
      baseAmountCents: e.base_amount,
      bonusCents: e.qc_bonus_amount ?? 0,
      penaltyCents: e.qc_penalty_amount ?? 0,
      reworkAmountCents: e.rework_amount ?? 0,
      minimumWageAdjustmentCents: e.minimum_wage_adjustment ?? 0,
      grossAmountCents: e.gross_amount,
    };
  });

  const summaries = aggregateCycle(cycleEntries, cycle);

  const employeeIds = summaries.map((s) => s.employeeId);
  const { data: ytdRows } = await supabase
    .from("payroll_ytd")
    .select("employee_id, ytd_pensionable_cents, ytd_insurable_cents, ytd_assessable_cents")
    .eq("calendar_year", calendarYear)
    .in("employee_id", employeeIds.length ? employeeIds : ["00000000-0000-0000-0000-000000000000"]);

  const ytdMap = new Map(
    (ytdRows || []).map((r) => [
      r.employee_id,
      {
        employeeId: r.employee_id,
        ytdPensionableCents: r.ytd_pensionable_cents,
        ytdInsurableCents: r.ytd_insurable_cents,
        ytdAssessableCents: r.ytd_assessable_cents,
      },
    ])
  );

  const { data: employeeRows } = await supabase
    .from("employees")
    .select("id, hire_date")
    .in("id", employeeIds.length ? employeeIds : ["00000000-0000-0000-0000-000000000000"]);

  const cycleEndDate = new Date(`${cycle.end}T00:00:00Z`);
  const yearsMap = new Map(
    (employeeRows || []).map((e) => {
      if (!e.hire_date) return [e.id, 0];
      const hire = new Date(`${e.hire_date}T00:00:00Z`);
      const years = (cycleEndDate.getTime() - hire.getTime()) / (365.25 * 24 * 3600 * 1000);
      return [e.id, Math.max(0, Math.floor(years))];
    })
  );

  const lines = buildCycleDeductions(summaries, ytdMap, yearsMap);
  const totals = totalCycleDeductions(lines);

  // Persistir el snapshot del ciclo + actualizar YTD para el siguiente ciclo del año.
  for (const line of lines) {
    const d = line.deductions;
    await supabase.from("payroll_cycle_deductions").upsert(
      {
        employee_id: line.employeeId,
        cycle_label: cycle.label,
        gross_cents: d.grossCents,
        cpp_cents: d.cpp.baseContributionCents,
        cpp2_cents: d.cpp.cpp2ContributionCents,
        ei_employee_cents: d.ei.employeeCents,
        ei_employer_cents: d.ei.employerCents,
        worksafebc_employer_cents: d.workSafeBc.employerCents,
        vacation_pay_accrual_cents: d.vacationPayAccrualCents,
        estimated_net_cents: d.estimatedNetCents,
        employer_cost_cents: d.employerCostCents,
      },
      { onConflict: "employee_id,cycle_label" }
    );

    await supabase.from("payroll_ytd").upsert(
      {
        employee_id: line.employeeId,
        calendar_year: calendarYear,
        ytd_pensionable_cents: d.cpp.ytdPensionableAfterCents,
        ytd_insurable_cents: d.ei.ytdInsurableAfterCents,
        ytd_assessable_cents: d.workSafeBc.ytdAssessableAfterCents,
        ytd_cpp_contribution_cents: d.cpp.baseContributionCents,
        ytd_cpp2_contribution_cents: d.cpp.cpp2ContributionCents,
        ytd_ei_employee_cents: d.ei.employeeCents,
        ytd_vacation_pay_accrued_cents: d.vacationPayAccrualCents,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "employee_id,calendar_year" }
    );
  }

  if (format === "csv") {
    const csv = cycleDeductionsToCsv(lines, cycle);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="nomina_${cycle.label.replace(/\s+/g, "_")}.csv"`,
      },
    });
  }

  return NextResponse.json({ cycle, lines, totals }, { status: 200 });
}

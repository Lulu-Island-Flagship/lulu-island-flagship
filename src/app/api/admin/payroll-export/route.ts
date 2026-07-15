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

  // v8.3 E9: readiness_requests resueltas como full_day_rate (modo "No estoy
  // listo", B.2.6) se pagan igual que un día trabajado — mismo agregador
  // puro (aggregateCycle), sin tocar payroll-cycle.ts ni payroll-deductions.ts.
  const { data: readinessCredits, error: readinessError } = await supabase
    .from("payroll_readiness_credits")
    .select("employee_id, day_rate_cents, credit_date, employees(name)")
    .gte("credit_date", cycle.start)
    .lte("credit_date", cycle.end)
    .is("deleted_at", null);

  if (readinessError) {
    return NextResponse.json({ error: readinessError.message }, { status: 500 });
  }

  type EmployeeNameJoin = { name: string } | { name: string }[] | null;
  const readinessCycleEntries: CycleEntry[] = (readinessCredits || []).map((c) => {
    const empJoin = c.employees as EmployeeNameJoin;
    const emp = Array.isArray(empJoin) ? empJoin[0] : empJoin;
    return {
      employeeId: c.employee_id,
      employeeName: emp?.name || "(sin nombre)",
      serviceDate: c.credit_date,
      baseAmountCents: c.day_rate_cents,
      bonusCents: 0,
      penaltyCents: 0,
      reworkAmountCents: 0,
      minimumWageAdjustmentCents: 0,
      grossAmountCents: c.day_rate_cents,
    };
  });

  // v8.3 E8 (D.11): bonos de insignias ganadas (employee_badge_bonuses,
  // migración 136) — mismo patrón exacto que los créditos de readiness de
  // arriba: no tocan payroll-cycle.ts, solo se funden como CycleEntry con
  // baseAmountCents=0 (el bono no reemplaza el día trabajado, se SUMA).
  const { data: badgeBonuses, error: badgeBonusError } = await supabase
    .from("employee_badge_bonuses")
    .select("employee_id, bonus_cents, credit_date, employees(name)")
    .gte("credit_date", cycle.start)
    .lte("credit_date", cycle.end)
    .is("deleted_at", null);

  if (badgeBonusError) {
    return NextResponse.json({ error: badgeBonusError.message }, { status: 500 });
  }

  const badgeBonusCycleEntries: CycleEntry[] = (badgeBonuses || []).map((b) => {
    const empJoin = b.employees as EmployeeNameJoin;
    const emp = Array.isArray(empJoin) ? empJoin[0] : empJoin;
    return {
      employeeId: b.employee_id,
      employeeName: emp?.name || "(sin nombre)",
      serviceDate: b.credit_date,
      baseAmountCents: 0,
      bonusCents: b.bonus_cents,
      penaltyCents: 0,
      reworkAmountCents: 0,
      minimumWageAdjustmentCents: 0,
      grossAmountCents: b.bonus_cents,
    };
  });

  // v8.3 E5.13: bono de $5 al líder mencionado por un cliente referido
  // (employee_referral_bonuses, migración 159) -- mismo patrón exacto que
  // los bonos de insignias de arriba.
  const { data: referralBonuses, error: referralBonusError } = await supabase
    .from("employee_referral_bonuses")
    .select("employee_id, bonus_cents, credit_date, employees(name)")
    .gte("credit_date", cycle.start)
    .lte("credit_date", cycle.end)
    .is("deleted_at", null);

  if (referralBonusError) {
    return NextResponse.json({ error: referralBonusError.message }, { status: 500 });
  }

  const referralBonusCycleEntries: CycleEntry[] = (referralBonuses || []).map((b) => {
    const empJoin = b.employees as EmployeeNameJoin;
    const emp = Array.isArray(empJoin) ? empJoin[0] : empJoin;
    return {
      employeeId: b.employee_id,
      employeeName: emp?.name || "(sin nombre)",
      serviceDate: b.credit_date,
      baseAmountCents: 0,
      bonusCents: b.bonus_cents,
      penaltyCents: 0,
      reworkAmountCents: 0,
      minimumWageAdjustmentCents: 0,
      grossAmountCents: b.bonus_cents,
    };
  });

  // v8.3 BC ESA Parte 5.1: días de enfermedad PAGADOS (sick_leave_requests,
  // pay_type='paid') -- antes se calculaba el monto correcto en
  // src/app/api/empleado/sick-leave/route.ts pero NUNCA llegaba a la nómina
  // real (bug real, hallazgo de auditoría de flujo del empleado). Mismo
  // patrón que readiness/badges/referidos: baseAmountCents=el día pagado,
  // se SUMA al ciclo, nunca reemplaza un servicio trabajado.
  const { data: sickLeavePays, error: sickLeaveError } = await supabase
    .from("sick_leave_requests")
    .select("employee_id, paid_amount_cents, absence_date, employees(name)")
    .eq("pay_type", "paid")
    .not("paid_amount_cents", "is", null)
    .gte("absence_date", cycle.start)
    .lte("absence_date", cycle.end);

  if (sickLeaveError) {
    return NextResponse.json({ error: sickLeaveError.message }, { status: 500 });
  }

  const sickLeaveCycleEntries: CycleEntry[] = (sickLeavePays || []).map((s) => {
    const empJoin = s.employees as EmployeeNameJoin;
    const emp = Array.isArray(empJoin) ? empJoin[0] : empJoin;
    return {
      employeeId: s.employee_id,
      employeeName: emp?.name || "(sin nombre)",
      serviceDate: s.absence_date,
      baseAmountCents: s.paid_amount_cents ?? 0,
      bonusCents: 0,
      penaltyCents: 0,
      reworkAmountCents: 0,
      minimumWageAdjustmentCents: 0,
      grossAmountCents: s.paid_amount_cents ?? 0,
    };
  });

  // v8.3 BC ESA Parte 5 s.42-45: festivos estatutarios pagados
  // (statutory_holiday_pay, eligible=true con average_day_pay_cents ya
  // calculado por el cron statutory-holiday-scan) -- mismo bug real que el
  // de arriba: la elegibilidad y el monto se calculaban pero nunca
  // llegaban a la nómina real.
  const { data: statHolidayPays, error: statHolidayError } = await supabase
    .from("statutory_holiday_pay")
    .select("employee_id, average_day_pay_cents, holiday_date, employees(name)")
    .eq("eligible", true)
    .eq("wage_data_unavailable", false)
    .not("average_day_pay_cents", "is", null)
    .gte("holiday_date", cycle.start)
    .lte("holiday_date", cycle.end);

  if (statHolidayError) {
    return NextResponse.json({ error: statHolidayError.message }, { status: 500 });
  }

  const statHolidayCycleEntries: CycleEntry[] = (statHolidayPays || []).map((h) => {
    const empJoin = h.employees as EmployeeNameJoin;
    const emp = Array.isArray(empJoin) ? empJoin[0] : empJoin;
    return {
      employeeId: h.employee_id,
      employeeName: emp?.name || "(sin nombre)",
      serviceDate: h.holiday_date,
      baseAmountCents: h.average_day_pay_cents ?? 0,
      bonusCents: 0,
      penaltyCents: 0,
      reworkAmountCents: 0,
      minimumWageAdjustmentCents: 0,
      grossAmountCents: h.average_day_pay_cents ?? 0,
    };
  });

  // v8.3 FIX-11 (BC ESA): pago final de Vacation Pay acumulado al terminar
  // el empleo (employee_final_payouts, migración 177) -- mismo bug real que
  // sick_leave/statutory_holiday: sin esto, un empleado dado de baja nunca
  // recibía su Vacation Pay acumulado en la nómina real.
  const { data: finalPayouts, error: finalPayoutsError } = await supabase
    .from("employee_final_payouts")
    .select("employee_id, amount_cents, payout_date, employees(name)")
    .gte("payout_date", cycle.start)
    .lte("payout_date", cycle.end);

  if (finalPayoutsError) {
    return NextResponse.json({ error: finalPayoutsError.message }, { status: 500 });
  }

  const finalPayoutCycleEntries: CycleEntry[] = (finalPayouts || []).map((p) => {
    const empJoin = p.employees as EmployeeNameJoin;
    const emp = Array.isArray(empJoin) ? empJoin[0] : empJoin;
    return {
      employeeId: p.employee_id,
      employeeName: emp?.name || "(sin nombre)",
      serviceDate: p.payout_date,
      baseAmountCents: p.amount_cents,
      bonusCents: 0,
      penaltyCents: 0,
      reworkAmountCents: 0,
      minimumWageAdjustmentCents: 0,
      grossAmountCents: p.amount_cents,
    };
  });

  const summaries = aggregateCycle(
    [
      ...cycleEntries,
      ...readinessCycleEntries,
      ...badgeBonusCycleEntries,
      ...referralBonusCycleEntries,
      ...sickLeaveCycleEntries,
      ...statHolidayCycleEntries,
      ...finalPayoutCycleEntries,
    ],
    cycle
  );

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

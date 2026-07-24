import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { getCycleForDate, getPreviousCycle, aggregateCycle, type CycleEntry } from "@/lib/payroll-cycle";
import {
  buildCycleDeductions,
  cycleDeductionsToCsvWithSin,
  attachSinToLines,
  totalCycleDeductions,
} from "@/lib/payroll-export";
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
    .select(
      "employee_id, gross_amount, base_amount, qc_bonus_amount, qc_penalty_amount, rework_amount, rework_paid_minutes, minimum_wage_adjustment, created_at, employees(name, hire_date)"
    )
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
      reworkPaidMinutes: e.rework_paid_minutes ?? 0,
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
    .select(
      "employee_id, ytd_pensionable_cents, ytd_insurable_cents, ytd_assessable_cents, ytd_cpp_contribution_cents, ytd_cpp2_contribution_cents, ytd_ei_employee_cents, ytd_vacation_pay_accrued_cents"
    )
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

  // v8.3 auditoría 2026-07-21 (D-P0-4/D-P0-5): antes de escribir nada,
  // averiguar qué empleados de este ciclo YA tenían una fila en
  // payroll_cycle_deductions para este mismo cycle_label. Ese ciclo ya
  // quedó sumado a payroll_ytd en la corrida anterior -- volver a sumarlo
  // aquí infla el YTD en cada recarga del navegador (bug real: 3 recargas
  // de un ciclo de $1,800 -> YTD de $5,400). El upsert de
  // payroll_cycle_deductions de abajo sigue siendo idempotente por sí
  // mismo (sobreescribe la misma fila con los mismos valores); lo que
  // faltaba era este guard antes de tocar payroll_ytd.
  const { data: existingCycleRows } = await supabase
    .from("payroll_cycle_deductions")
    .select("employee_id")
    .eq("cycle_label", cycle.label)
    .in("employee_id", employeeIds.length ? employeeIds : ["00000000-0000-0000-0000-000000000000"]);
  const alreadyProcessedThisCycle = new Set((existingCycleRows || []).map((r) => r.employee_id));

  const ytdContributionsMap = new Map(
    (ytdRows || []).map((r) => [
      r.employee_id,
      {
        cppContributionCents: r.ytd_cpp_contribution_cents ?? 0,
        cpp2ContributionCents: r.ytd_cpp2_contribution_cents ?? 0,
        eiEmployeeCents: r.ytd_ei_employee_cents ?? 0,
        vacationPayAccruedCents: r.ytd_vacation_pay_accrued_cents ?? 0,
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

    // v8.3 (D-P0-5): si este ciclo YA se había procesado antes para este
    // empleado, el YTD ya lo incluye -- no volver a sumarlo. Esta es la
    // idempotencia real (antes format=json por defecto + recargar la
    // página bastaba para inflar el YTD).
    if (alreadyProcessedThisCycle.has(line.employeeId)) {
      continue;
    }

    // v8.3 (D-P0-4): estos 4 campos son ACUMULADOS del año, igual que los
    // otros tres (ytd_pensionable/insurable/assessable, que ya llegan
    // correctamente sumados desde buildCycleDeductions vía ytdMap). Antes
    // se sobrescribían con el valor de ESTE ciclo únicamente -- el
    // finiquito de vacaciones (que lee ytd_vacation_pay_accrued_cents)
    // pagaba solo el último ciclo en vez del año completo (4% de lo
    // debido en el caso reportado).
    const priorContributions = ytdContributionsMap.get(line.employeeId) ?? {
      cppContributionCents: 0,
      cpp2ContributionCents: 0,
      eiEmployeeCents: 0,
      vacationPayAccruedCents: 0,
    };

    await supabase.from("payroll_ytd").upsert(
      {
        employee_id: line.employeeId,
        calendar_year: calendarYear,
        ytd_pensionable_cents: d.cpp.ytdPensionableAfterCents,
        ytd_insurable_cents: d.ei.ytdInsurableAfterCents,
        ytd_assessable_cents: d.workSafeBc.ytdAssessableAfterCents,
        ytd_cpp_contribution_cents: priorContributions.cppContributionCents + d.cpp.baseContributionCents,
        ytd_cpp2_contribution_cents: priorContributions.cpp2ContributionCents + d.cpp.cpp2ContributionCents,
        ytd_ei_employee_cents: priorContributions.eiEmployeeCents + d.ei.employeeCents,
        ytd_vacation_pay_accrued_cents:
          priorContributions.vacationPayAccruedCents + d.vacationPayAccrualCents,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "employee_id,calendar_year" }
    );
  }

  if (format === "csv") {
    // v8.3 P0-8 (auditoría Fable5): el CSV de nómina real (el que va a CRA/
    // contabilidad) debe incluir el SIN descifrado. `resource: "payroll"`
    // ya está restringido a owner_admin en admin-rbac.ts (MATRIX.payroll =
    // ["owner_admin"]) -- requireAdminRole() de arriba ya lo garantizó antes
    // de llegar aquí, así que quien pide format=csv siempre es owner_admin.
    // get_employee_banking_info() (RPC, migración 204) vuelve a exigir el
    // mismo rol por su cuenta -- nunca se lee sin_encrypted directo de la
    // tabla. Si PAYROLL_ENCRYPTION_KEY no está configurada (staging/dev sin
    // nómina real todavía) o el RPC falla para un empleado puntual, el
    // export degrada a SIN vacío para ese empleado en vez de tumbar todo el
    // CSV -- un problema de un empleado sin SIN capturado no debe bloquear
    // el pago del resto.
    const encryptionKey = process.env.PAYROLL_ENCRYPTION_KEY;
    const sinByEmployee = new Map<string, string | null>();
    if (!encryptionKey) {
      console.warn(
        "payroll-export: PAYROLL_ENCRYPTION_KEY no configurada -- el CSV se genera SIN columna de SIN. Configúrala antes de la primera nómina real (ver comentario en supabase/migrations/204_e9_employee_sin_banking_encrypted.sql)."
      );
    } else {
      for (const employeeId of employeeIds) {
        const { data: bankingRows, error: bankingError } = await supabase.rpc("get_employee_banking_info", {
          p_employee_id: employeeId,
          p_encryption_key: encryptionKey,
        });
        if (bankingError) {
          console.error(`payroll-export: get_employee_banking_info falló para ${employeeId}:`, bankingError.message);
          sinByEmployee.set(employeeId, null);
          continue;
        }
        const row = Array.isArray(bankingRows) ? bankingRows[0] : bankingRows;
        sinByEmployee.set(employeeId, row?.sin ?? null);
      }
    }

    const linesWithSin = attachSinToLines(lines, sinByEmployee);
    const csv = cycleDeductionsToCsvWithSin(linesWithSin, cycle);
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

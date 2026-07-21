import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  computeBcStatutoryHolidays,
  decideStatHolidayEligibility,
  computeAverageDayPay,
} from "@/lib/statutory-holidays";

/**
 * POST /api/cron/statutory-holiday-scan — v8.3 BC ESA Parte 5 s.42-45.
 *
 * Diario: si hoy es uno de los 11 festivos estatutarios de BC, calcula
 * elegibilidad y "average day's pay" por empleado activo.
 *
 * Honestidad de alcance: "días trabajados en los 30 días anteriores" se
 * cuenta con `assignments.status='completed'` (tabla real, sí se
 * actualiza) -- pero el SALARIO total de esos días debería venir de
 * `payroll_entries.gross_amount`, y hoy NINGUNA ruta del código inserta
 * filas ahí (ver nota en src/lib/payroll.ts#calculateOvertimePay). Si no
 * hay filas de payroll_entries en la ventana, este cron NO inventa un
 * monto: guarda `wage_data_unavailable=true` y `average_day_pay_cents=null`,
 * dejando la ELEGIBILIDAD (que sí es real) calculada de todos modos.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (authHeader?.replace("Bearer ", "") !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: "Supabase service credentials not configured" }, { status: 500 });
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const today = new Date();
    const todayISO = today.toISOString().slice(0, 10);
    const holidays = computeBcStatutoryHolidays(today.getUTCFullYear());
    const todaysHoliday = holidays.find((h) => h.dateISO === todayISO);

    if (!todaysHoliday) {
      return NextResponse.json({ skipped: true, reason: "not_a_statutory_holiday_today" }, { status: 200 });
    }

    const { data: employees, error: employeesError } = await supabase
      .from("employees")
      .select("id, hire_date")
      .eq("is_active", true);
    if (employeesError) return NextResponse.json({ error: employeesError.message }, { status: 500 });

    const windowStart = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

    let eligibleCount = 0;
    const inserts: Record<string, unknown>[] = [];

    for (const employee of employees || []) {
      const daysEmployedAtHoliday = employee.hire_date
        ? Math.floor((today.getTime() - new Date(employee.hire_date).getTime()) / 86400000)
        : 0;

      // v8.3 auditoría 2026-07-21 (D-P1-2): sin "!inner", PostgREST no usa
      // el embed `orders(service_date)` como filtro de la fila padre --
      // los .gte()/.lt() sobre "orders.service_date" se ignoraban en
      // silencio y daysWorkedInPrior30 salía 0 para todos, dejando a
      // todo el mundo eligible:false. El patrón correcto ya existe en el
      // repo (evaluate-badges:66).
      const { data: completedAssignments } = await supabase
        .from("assignments")
        .select("order_id, orders!inner(service_date)")
        .eq("employee_id", employee.id)
        .eq("status", "completed")
        .gte("orders.service_date", windowStart.toISOString().slice(0, 10))
        .lt("orders.service_date", todayISO);

      const distinctDaysWorked = new Set(
        (completedAssignments || [])
          .map((a: { orders: { service_date: string } | { service_date: string }[] | null }) => {
            const orderData = Array.isArray(a.orders) ? a.orders[0] : a.orders;
            return orderData?.service_date;
          })
          .filter((d): d is string => Boolean(d))
      );
      const daysWorkedInPrior30 = distinctDaysWorked.size;

      const eligibility = decideStatHolidayEligibility({
        daysEmployedAtHoliday: Math.max(0, daysEmployedAtHoliday),
        daysWorkedInPrior30,
      });

      let averageDayPayCents: number | null = null;
      let wageDataUnavailable = false;

      if (eligibility.eligible) {
        eligibleCount++;
        const { data: wageRows } = await supabase
          .from("payroll_entries")
          .select("gross_amount")
          .eq("employee_id", employee.id)
          .gte("created_at", windowStart.toISOString())
          .lt("created_at", today.toISOString());

        if (wageRows && wageRows.length > 0) {
          const totalWagesCents = wageRows.reduce((sum, r) => sum + (r.gross_amount || 0), 0);
          averageDayPayCents = computeAverageDayPay(totalWagesCents, daysWorkedInPrior30);
        } else {
          wageDataUnavailable = true;
        }
      }

      inserts.push({
        employee_id: employee.id,
        holiday_name: todaysHoliday.name,
        holiday_date: todaysHoliday.dateISO,
        eligible: eligibility.eligible,
        eligibility_reason: eligibility.reason,
        days_worked_in_prior_30: daysWorkedInPrior30,
        wage_data_unavailable: wageDataUnavailable,
        average_day_pay_cents: averageDayPayCents,
      });
    }

    if (inserts.length > 0) {
      const { error: insertError } = await supabase
        .from("statutory_holiday_pay")
        .upsert(inserts, { onConflict: "employee_id,holiday_date", ignoreDuplicates: true });
      if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json(
      { holiday: todaysHoliday.name, employeesEvaluated: (employees || []).length, eligibleCount },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

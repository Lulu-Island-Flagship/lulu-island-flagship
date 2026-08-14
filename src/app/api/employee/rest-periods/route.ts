
import { NextRequest, NextResponse } from "next/server";
import { safeErrorResponse } from "@/lib/api-errors";
import { requireActiveEmployee } from "@/lib/require-active-employee";
import { createRouteSupabaseClient } from "@/lib/supabase-server";
/**
 * GET /api/employee/rest-periods — el registro de descansos documentados
 * del propio empleado (últimos 30 días), para que pueda ver que sus
 * descansos de tránsito quedaron registrados. Ver honestidad en
 * src/lib/rest-documentation.ts: si su rol ese día fue 'driver', sus
 * tramos de tránsito NUNCA cuentan como descanso (sigue siendo trabajo).
 */
export async function GET(_request: NextRequest) {
  try {
    const supabase = await createRouteSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { employee, error: empError, status: empStatus } = await requireActiveEmployee(supabase, user.id);
    if (!employee) return NextResponse.json({ error: empError }, { status: empStatus });

    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 30);

    const { data: periods, error } = await supabase
      .from("employee_rest_periods")
      .select(
        "id, work_date, rest_start_at, rest_end_at, duration_minutes, role_during_rest, satisfies_esa_break, reason"
      )
      .eq("employee_id", employee.id)
      .gte("work_date", since.toISOString().slice(0, 10))
      .order("rest_start_at", { ascending: false });

    if (error) {
      console.error("Supabase query error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json({ periods: periods || [] }, { status: 200 });
  } catch (err) {
    return safeErrorResponse(err);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";

/**
 * GET /api/admin/rest-periods — v8.3 (BC ESA s.32). Vista de cumplimiento:
 * por empleado/día, cuántos tramos de tránsito se documentaron y cuántos
 * SÍ calificaron como el descanso legal. Un día con cumulative_continuous
 * >=300 min y CERO tramos satisfaciendo el descanso es una señal real de
 * riesgo de incumplimiento -- se marca explícitamente, no se opina más
 * allá de eso.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("compliance", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  const { searchParams } = new URL(request.url);
  const days = Math.min(90, Math.max(1, parseInt(searchParams.get("days") || "14", 10)));
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);

  const { data: periods, error } = await auth.supabase
    .from("employee_rest_periods")
    .select("employee_id, work_date, duration_minutes, cumulative_continuous_minutes_before, role_during_rest, satisfies_esa_break")
    .gte("work_date", since.toISOString().slice(0, 10))
    .order("work_date", { ascending: false });
  if (error) {
    console.error("admin/rest-periods error:", error);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  const employeeIds = Array.from(new Set((periods || []).map((p) => p.employee_id)));
  const nameById = new Map<string, string>();
  if (employeeIds.length > 0) {
    const { data: employees } = await auth.supabase.from("employees").select("id, name").in("id", employeeIds);
    for (const e of employees || []) nameById.set(e.id, e.name);
  }

  const byEmployeeDay = new Map<
    string,
    { employeeId: string; workDate: string; segments: number; satisfying: number; maxCumulativeBefore: number }
  >();
  for (const p of periods || []) {
    const key = `${p.employee_id}|${p.work_date}`;
    const row = byEmployeeDay.get(key) || {
      employeeId: p.employee_id,
      workDate: p.work_date,
      segments: 0,
      satisfying: 0,
      maxCumulativeBefore: 0,
    };
    row.segments++;
    if (p.satisfies_esa_break) row.satisfying++;
    row.maxCumulativeBefore = Math.max(row.maxCumulativeBefore, p.cumulative_continuous_minutes_before);
    byEmployeeDay.set(key, row);
  }

  const rows = Array.from(byEmployeeDay.values()).map((r) => ({
    ...r,
    employeeName: nameById.get(r.employeeId) || r.employeeId,
    atRisk: r.maxCumulativeBefore >= 300 && r.satisfying === 0,
  }));

  return NextResponse.json(
    { rows, atRiskCount: rows.filter((r) => r.atRisk).length },
    { status: 200 }
  );
}

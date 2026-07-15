import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";

/** GET /api/admin/weekly-rest-violations — v8.3 BC ESA s.35. */
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("compliance", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  const { data: violations, error } = await auth.supabase
    .from("weekly_rest_violations")
    .select("id, employee_id, week_start, week_end, longest_gap_hours, shifts_count, acknowledged_at")
    .order("week_start", { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const employeeIds = Array.from(new Set((violations || []).map((v) => v.employee_id)));
  const nameById = new Map<string, string>();
  if (employeeIds.length > 0) {
    const { data: employees } = await auth.supabase.from("employees").select("id, name").in("id", employeeIds);
    for (const e of employees || []) nameById.set(e.id, e.name);
  }

  const enriched = (violations || []).map((v) => ({ ...v, employeeName: nameById.get(v.employee_id) || v.employee_id }));

  return NextResponse.json({ violations: enriched }, { status: 200 });
}

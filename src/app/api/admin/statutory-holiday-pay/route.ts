import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { computeBcStatutoryHolidays } from "@/lib/statutory-holidays";

/** GET /api/admin/statutory-holiday-pay?year=2026 — v8.3 BC ESA Parte 5. */
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("compliance", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get("year") || String(new Date().getUTCFullYear()), 10);
  const upcomingHolidays = computeBcStatutoryHolidays(year);

  const { data: records, error } = await auth.supabase
    .from("statutory_holiday_pay")
    .select(
      "id, employee_id, holiday_name, holiday_date, eligible, eligibility_reason, days_worked_in_prior_30, wage_data_unavailable, average_day_pay_cents"
    )
    .gte("holiday_date", `${year}-01-01`)
    .lte("holiday_date", `${year}-12-31`)
    .order("holiday_date", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const employeeIds = Array.from(new Set((records || []).map((r) => r.employee_id)));
  const nameById = new Map<string, string>();
  if (employeeIds.length > 0) {
    const { data: employees } = await auth.supabase.from("employees").select("id, name").in("id", employeeIds);
    for (const e of employees || []) nameById.set(e.id, e.name);
  }

  const enriched = (records || []).map((r) => ({ ...r, employeeName: nameById.get(r.employee_id) || r.employee_id }));

  return NextResponse.json({ holidays: upcomingHolidays, records: enriched }, { status: 200 });
}


import { NextResponse } from "next/server";
import { safeErrorResponse } from "@/lib/api-errors";
import { computeClosingEarnings } from "@/lib/shift-ritual";
import { requireActiveEmployee } from "@/lib/require-active-employee";
import { createRouteSupabaseClient } from "@/lib/supabase-server";
/**
 * GET /api/employee/ritual/close — v8.3 E8.13: "fin de jornada: ganancias
 * visibles ('Day Rate $90 + comisiones $12.50 = $102.50') + progreso de
 * insignias." Day Rate desde employees.day_rate, comisión desde los
 * upsells aprobados por el cliente HOY (service_upsells), insignias
 * totales desde employee_badges.
 */
export async function GET() {
  try {
    const supabase = createRouteSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { employee, error: empError, status: empStatus } = await requireActiveEmployee<{
      id: string;
      name: string | null;
      day_rate: number | null;
    }>(supabase, user.id, "id, name, day_rate");
    if (!employee) return NextResponse.json({ error: empError }, { status: empStatus });

    const vancouverDate = new Date().toLocaleString("en-CA", {
      timeZone: "America/Vancouver",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const today = vancouverDate.split(",")[0];

    const { data: upsells } = await supabase
      .from("service_upsells")
      .select("amount, created_at")
      .eq("employee_id", employee.id)
      .eq("client_approved", true)
      .gte("created_at", `${today}T00:00:00`)
      .lt("created_at", `${today}T23:59:59.999`);

    const approvedUpsellAmountsDollars = (upsells ?? []).map((u) => Number(u.amount));

    // Guard: null day_rate means the employee hasn't had a rate configured yet.
    // Number(null) === 0 would silently show "$0.00", indistinguishable from a legitimate $0 day.
    if (employee.day_rate == null) {
      return NextResponse.json(
        { employeeName: employee.name, earnings: null, badgeCount: 0, message: "Day rate not configured yet" },
        { status: 200 }
      );
    }

    const earnings = computeClosingEarnings({
      dayRateDollars: Number(employee.day_rate),
      approvedUpsellAmountsDollars,
    });

    const { count: badgeCount } = await supabase
      .from("employee_badges")
      .select("id", { count: "exact", head: true })
      .eq("employee_id", employee.id);

    return NextResponse.json(
      { employeeName: employee.name, earnings, badgeCount: badgeCount ?? 0 },
      { status: 200 }
    );
  } catch (err) {
    return safeErrorResponse(err);
  }
}

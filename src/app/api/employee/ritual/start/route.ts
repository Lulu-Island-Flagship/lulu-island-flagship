
import { NextResponse } from "next/server";
import { safeErrorResponse } from "@/lib/api-errors";
import { getMorningConditions } from "@/lib/traffic-conditions-provider";
import { formatAggregatedRows } from "@/lib/team-ranking";
import { requireActiveEmployee } from "@/lib/require-active-employee";
import { createRouteSupabaseClient } from "@/lib/supabase-server";
import { getVancouverTodayString } from "@/lib/date-utils";
function mostRecentMonday(d: Date): string {
  const day = d.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - diff);
  return monday.toISOString().split("T")[0];
}

/**
 * GET /api/employee/ritual/start — v8.3 E8.13: "ritual de inicio de
 * jornada: equipo, clima, ranking" en una sola llamada. Compañeros de hoy
 * (mismo criterio que team-chat: co-asignados en las mismas órdenes),
 * clima/tráfico (honesto not_configured mientras no haya proveedor real,
 * ver traffic-conditions-provider.ts), y el Top 3 semanal (misma RPC
 * truncada a 3 que ya usa el admin).
 */
export async function GET() {
  try {
    const supabase = createRouteSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { employee, error: empError, status: empStatus } = await requireActiveEmployee<{
      id: string;
      name: string | null;
    }>(supabase, user.id, "id, name");
    if (!employee) return NextResponse.json({ error: empError }, { status: empStatus });

    const vancouverDate = new Date().toLocaleString("en-CA", {
      timeZone: "America/Vancouver",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const today = vancouverDate.split(",")[0];

    const { data: myOrders } = await supabase
      .from("orders")
      .select("id, quotes:quote_id ( zone )")
      .eq("service_date", today);

    const { data: myAssignments } = await supabase
      .from("assignments")
      .select("order_id")
      .eq("employee_id", employee.id)
      .is("deleted_at", null)
      .in("order_id", (myOrders ?? []).map((o) => o.id));

    const myOrderIds = (myAssignments ?? []).map((a) => a.order_id);

    let teammates: { name: string }[] = [];
    let zone: string | null = null;
    if (myOrderIds.length > 0) {
      const { data: coAssignments } = await supabase
        .from("assignments")
        .select("employee_id, employees:employee_id ( name )")
        .in("order_id", myOrderIds)
        .neq("employee_id", employee.id)
        .is("deleted_at", null);

      const seen = new Set<string>();
      teammates = (coAssignments ?? [])
        .map((a) => (a.employees as unknown as { name: string } | null)?.name)
        .filter((name): name is string => {
          if (!name || seen.has(name)) return false;
          seen.add(name);
          return true;
        })
        .map((name) => ({ name }));

      const firstOrder = (myOrders ?? []).find((o) => myOrderIds.includes(o.id));
      zone = (firstOrder?.quotes as unknown as { zone: string } | null)?.zone ?? null;
    }

    // Graceful degradation: if the morning conditions provider throws,
    // log the error and fall back to "not_configured" instead of crashing
    // the whole endpoint.
    let conditions = null;
    if (zone) {
      try {
        conditions = await getMorningConditions({ zone, date: today });
      } catch (condErr) {
        console.error("Morning conditions lookup failed", condErr);
        // conditions stays null → the response will report "not_configured"
      }
    }

    // Fix (auditoría timezone): ver comentario equivalente en empleado/team-ranking.
    const weekStart = mostRecentMonday(new Date(`${getVancouverTodayString()}T12:00:00Z`));
    const { data: rankingData } = await supabase.rpc("get_team_top3", { p_week_start: weekStart });
    const top3 = formatAggregatedRows(
      (rankingData || []).map((r: { team_id: string; team_name: string; composite_score: number }) => ({
        teamId: r.team_id,
        teamName: r.team_name,
        compositeScore: Number(r.composite_score),
      }))
    );

    return NextResponse.json(
      {
        employeeName: employee.name,
        teammates,
        conditions: conditions
          ? { status: conditions.status, condition: conditions.condition, delayMinutes: conditions.estimatedDelayMinutes }
          : { status: "not_configured", condition: null, delayMinutes: null },
        top3,
      },
      { status: 200 }
    );
  } catch (err) {
    return safeErrorResponse(err);
  }
}

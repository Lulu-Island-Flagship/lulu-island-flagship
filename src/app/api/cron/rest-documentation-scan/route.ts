import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { createClient } from "@supabase/supabase-js";
import { getVancouverTodayMidnight } from "@/lib/date-utils";
import { safeErrorResponse } from "@/lib/api-errors";
import {
  decideRestDocumentation,
  computeContinuousMinutesAfterTransit,
  type RestRole,
} from "@/lib/rest-documentation";

/**
 * POST /api/cron/rest-documentation-scan — documenta el descanso legal
 * (BC ESA s.32, 30 min tras 5h continuas) usando el tránsito real entre
 * servicios (service_logs t_out -> t_in del siguiente order), pedido
 * explícitamente por el negocio: "el tiempo que van en el carro podría
 * ser descanso". Ver honestidad de alcance en src/lib/rest-documentation.ts
 * -- el conductor NUNCA queda documentado como en descanso durante ese
 * tránsito (sigue trabajando); solo los pasajeros, y solo si ya
 * acumularon 5h continuas antes.
 *
 * Corre diario sobre el día de AYER (Vancouver) para que la jornada ya
 * esté completa cuando se procesa.
 */
export async function GET(request: NextRequest) {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: "Supabase service credentials not configured" }, { status: 500 });
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const todayMidnight = getVancouverTodayMidnight();
    const yesterdayStart = new Date(todayMidnight.getTime() - 24 * 60 * 60 * 1000);
    const yesterdayEnd = todayMidnight;
    const workDate = yesterdayStart.toISOString().slice(0, 10);

    const { data: logs, error: logsError } = await supabase
      .from("service_logs")
      .select("employee_id, order_id, event_type, timestamp")
      .in("event_type", ["t_in", "t_out"])
      .gte("timestamp", yesterdayStart.toISOString())
      .lt("timestamp", yesterdayEnd.toISOString())
      .order("timestamp", { ascending: true });
    if (logsError) {
      console.error("logsError:", logsError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }
    const employeeIds = Array.from(new Set((logs || []).map((l) => l.employee_id)));
    const roleByEmployee = new Map<string, RestRole>();
    if (employeeIds.length > 0) {
      const { data: employeeRows } = await supabase
        .from("employees")
        .select("id, role")
        .in("id", employeeIds);
      for (const e of employeeRows || []) {
        roleByEmployee.set(e.id, e.role === "driver" ? "driver" : "passenger");
      }
    }

    // Agrupar eventos por empleado, en orden cronológico.
    const eventsByEmployee = new Map<string, { order_id: string; event_type: string; timestamp: string }[]>();
    for (const log of logs || []) {
      const list = eventsByEmployee.get(log.employee_id) || [];
      list.push({ order_id: log.order_id, event_type: log.event_type, timestamp: log.timestamp });
      eventsByEmployee.set(log.employee_id, list);
    }

    let periodsDocumented = 0;
    let periodsSatisfyingBreak = 0;
    const inserts: Record<string, unknown>[] = [];

    for (const [employeeId, events] of Array.from(eventsByEmployee)) {
      const role = roleByEmployee.get(employeeId) || "passenger";
      let cumulativeContinuous = 0;
      let pendingOut: { order_id: string; timestamp: string } | null = null;
      let pendingIn: { order_id: string; timestamp: string } | null = null;

      for (const event of events) {
        if (event.event_type === "t_in") {
          if (pendingOut && pendingOut.order_id !== event.order_id) {
            // Tránsito entre el t_out anterior y este t_in de un order distinto.
            const transitMs = new Date(event.timestamp).getTime() - new Date(pendingOut.timestamp).getTime();
            const transitMinutes = Math.round(transitMs / 60000);
            if (transitMinutes > 0) {
              const decision = decideRestDocumentation({
                transitMinutes,
                cumulativeContinuousMinutesBefore: cumulativeContinuous,
                role,
              });
              inserts.push({
                employee_id: employeeId,
                work_date: workDate,
                order_id_before: pendingOut.order_id,
                order_id_after: event.order_id,
                rest_start_at: pendingOut.timestamp,
                rest_end_at: event.timestamp,
                duration_minutes: transitMinutes,
                cumulative_continuous_minutes_before: cumulativeContinuous,
                role_during_rest: role,
                satisfies_esa_break: decision.satisfiesEsaBreak,
                reason: decision.reason,
              });
              periodsDocumented++;
              if (decision.satisfiesEsaBreak) periodsSatisfyingBreak++;
              cumulativeContinuous = computeContinuousMinutesAfterTransit(
                cumulativeContinuous,
                transitMinutes,
                decision,
                role
              );
            }
            pendingOut = null;
          }
          pendingIn = { order_id: event.order_id, timestamp: event.timestamp };
        } else if (event.event_type === "t_out") {
          if (pendingIn && pendingIn.order_id === event.order_id) {
            const workMs = new Date(event.timestamp).getTime() - new Date(pendingIn.timestamp).getTime();
            const workMinutes = Math.max(0, Math.round(workMs / 60000));
            cumulativeContinuous += workMinutes;
            pendingIn = null;
          }
          pendingOut = { order_id: event.order_id, timestamp: event.timestamp };
        }
      }
    }

    if (inserts.length > 0) {
      const { error: insertError } = await supabase
        .from("employee_rest_periods")
        .upsert(inserts, { onConflict: "employee_id,order_id_before,order_id_after", ignoreDuplicates: true });
      if (insertError) {
        console.error("insertError:", insertError);
        return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
      }
    }

    return NextResponse.json(
      { workDate, employeesProcessed: eventsByEmployee.size, periodsDocumented, periodsSatisfyingBreak },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

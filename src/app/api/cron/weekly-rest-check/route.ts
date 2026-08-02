import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { evaluateWeeklyRest, type ShiftInterval } from "@/lib/shift-rest";
import { safeErrorResponse } from "@/lib/api-errors";

/**
 * POST /api/cron/weekly-rest-check — v8.3 (BC ESA s.35). Semanal: para
 * cada empleado activo, reconstruye sus turnos de la semana anterior
 * (jornada_start -> jornada_end en service_logs) y evalúa si tuvo al
 * menos 32h consecutivas de descanso (src/lib/shift-rest.ts). Solo
 * alerta -- no bloquea nada (ver nota de alcance en la migración 172).
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
    const weekEnd = new Date(today);
    weekEnd.setUTCHours(0, 0, 0, 0);
    const weekStart = new Date(weekEnd.getTime() - 7 * 24 * 60 * 60 * 1000);

    const { data: logs, error: logsError } = await supabase
      .from("service_logs")
      .select("employee_id, event_type, timestamp")
      .in("event_type", ["jornada_start", "jornada_end"])
      .gte("timestamp", weekStart.toISOString())
      .lt("timestamp", weekEnd.toISOString())
      .order("timestamp", { ascending: true });
    if (logsError) {
      console.error("logsError:", logsError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }
    const eventsByEmployee = new Map<string, { event_type: string; timestamp: string }[]>();
    for (const log of logs || []) {
      const list = eventsByEmployee.get(log.employee_id) || [];
      list.push({ event_type: log.event_type, timestamp: log.timestamp });
      eventsByEmployee.set(log.employee_id, list);
    }

    let employeesEvaluated = 0;
    let violationsFound = 0;
    const inserts: Record<string, unknown>[] = [];

    for (const [employeeId, events] of Array.from(eventsByEmployee)) {
      const shifts: ShiftInterval[] = [];
      let pendingStart: string | null = null;
      for (const event of events) {
        if (event.event_type === "jornada_start") {
          pendingStart = event.timestamp;
        } else if (event.event_type === "jornada_end" && pendingStart) {
          shifts.push({ startISO: pendingStart, endISO: event.timestamp });
          pendingStart = null;
        }
      }

      if (shifts.length === 0) continue;
      employeesEvaluated++;

      const result = evaluateWeeklyRest(shifts);
      if (!result.satisfiesWeeklyRest) {
        violationsFound++;
        inserts.push({
          employee_id: employeeId,
          week_start: weekStart.toISOString().slice(0, 10),
          week_end: weekEnd.toISOString().slice(0, 10),
          longest_gap_hours: Math.round(result.longestGapHours * 100) / 100,
          shifts_count: shifts.length,
        });
      }
    }

    if (inserts.length > 0) {
      const { error: insertError } = await supabase
        .from("weekly_rest_violations")
        .upsert(inserts, { onConflict: "employee_id,week_start", ignoreDuplicates: true });
      if (insertError) {
        console.error("insertError:", insertError);
        return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
      }
    }

    return NextResponse.json({ employeesEvaluated, violationsFound }, { status: 200 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

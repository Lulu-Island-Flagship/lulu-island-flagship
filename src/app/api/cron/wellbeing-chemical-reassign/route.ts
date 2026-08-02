import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isChemicalAlertTimerExpired, resolveChemicalReassignment } from "@/lib/wellbeing";
import { publishUnifiedAlert } from "@/lib/unified-alerts";
import { requireCronAuth } from "@/lib/cron-auth";
import { safeErrorResponse } from "@/lib/api-errors";

// GET /api/cron/wellbeing-chemical-reassign — v8.3 E8 regla dura: timer de
// 10 min sin respuesta admin => reasignación REAL, no solo detección.
//
// Antes de esta versión, este cron solo marcaba resolution=auto_reassigned
// sin tocar ninguna asignación real (ver historial de esta migración/commit
// para el comentario original que lo admitía explícitamente).
//
// Reasignación real, con el esquema actual (assignments es por ORDEN, no
// hay "nivel de riesgo por tarea"):
//   1. El empleado reportado queda restringido a tareas de bajo riesgo el
//      resto de la jornada (assignments.restricted_to_low_risk_at).
//   2. Un compañero YA asignado a la misma orden asume la responsabilidad
//      química, elegido con el mismo criterio de prioridad que
//      dispatch-team.ts::buildTeam (supervisor > trust level) — ver
//      resolveChemicalReassignment en src/lib/wellbeing.ts (no se duplica
//      la lógica de selección, se reutiliza el mismo criterio de afinidad).
//   3. Si no hay compañero en la orden (asignación de una sola persona), se
//      escala al admin de inmediato vía tickets_disputas — regla
//      pre-aprobada del fallback de 10 min (B.2.12), logueada.
//
// Usa SUPABASE_SERVICE_ROLE_KEY (igual que el resto de los crons, ej.
// no-show, batch-capture) porque esta ruta corre server-to-server sin
// sesión de usuario: con el cliente anon+cookies anterior, is_supervisor
// (auth.uid()) evaluaba NULL y la RLS de wellbeing_chemical_alerts
// bloqueaba silenciosamente cualquier UPDATE.
export async function GET(request: NextRequest) {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: "Supabase service credentials not configured" },
      { status: 500 }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const now = new Date().toISOString();

    const { data: pending, error } = await supabase
      .from("wellbeing_chemical_alerts")
      .select("id, employee_id, assignment_id, reported_at, admin_responded_at")
      .or("resolution.eq.pending,resolution.is.null");

    if (error) {
      console.error("Supabase query error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    const expired = (pending || []).filter((a) =>
      isChemicalAlertTimerExpired(a.reported_at, now, a.admin_responded_at)
    );

    let reassignedWithBackup = 0;
    let escalatedNoBackup = 0;
    let skippedNoAssignment = 0;

    for (const alert of expired) {
      if (!alert.assignment_id) {
        // Alerta sin asignación vinculada (posible en el checklist matutino
        // antes de que el empleado tenga orden asignada del día): no hay
        // orden sobre la cual reasignar nada. Se marca resuelto igual para
        // no dejarlo colgado en la cola, pero sin backup posible.
        await supabase
          .from("wellbeing_chemical_alerts")
          .update({ resolution: "auto_reassigned", auto_reassigned_at: now, escalated_no_backup: true })
          .eq("id", alert.id);
        skippedNoAssignment++;
        continue;
      }

      const { data: flaggedAssignment } = await supabase
        .from("assignments")
        .select("id, order_id, employee_id")
        .eq("id", alert.assignment_id)
        .single();

      if (!flaggedAssignment) {
        await supabase
          .from("wellbeing_chemical_alerts")
          .update({ resolution: "auto_reassigned", auto_reassigned_at: now, escalated_no_backup: true })
          .eq("id", alert.id);
        skippedNoAssignment++;
        continue;
      }

      const { data: teammateAssignments } = await supabase
        .from("assignments")
        .select("employee_id, employees(role, trust_level)")
        .eq("order_id", flaggedAssignment.order_id)
        .not("status", "in", "(cancelled,no_show)");

      type EmployeeJoin = { role: string; trust_level: string } | { role: string; trust_level: string }[] | null;
      const teammates = (teammateAssignments || []).map((a) => {
        const empJoin = a.employees as EmployeeJoin;
        const emp = Array.isArray(empJoin) ? empJoin[0] : empJoin;
        return {
          employeeId: a.employee_id as string,
          role: (emp?.role ?? "cleaner") as "cleaner" | "supervisor" | "driver",
          trustLevel: emp?.trust_level ?? "standard",
        };
      });

      const resolution = resolveChemicalReassignment(teammates, flaggedAssignment.employee_id);

      // 1. Restringir al empleado reportado a tareas de bajo riesgo el resto de la jornada.
      await supabase
        .from("assignments")
        .update({ restricted_to_low_risk_at: now })
        .eq("id", flaggedAssignment.id);

      if (resolution.escalateToAdmin) {
        // 3. Sin compañero disponible: escalar al admin de inmediato (fallback pre-aprobado).
        await supabase.from("tickets_disputas").insert({
          order_id: flaggedAssignment.order_id,
          employee_id: flaggedAssignment.employee_id,
          type: "wellbeing_no_backup",
          priority: "high",
          status: "open",
          context: {
            wellbeingChemicalAlertId: alert.id,
            reason:
              "Alerta de bienestar químico vencida a los 10 min sin respuesta admin y sin compañero disponible en la orden para asumir la tarea de riesgo.",
          },
        });
        // v8.3 E0.6: bandeja unificada. Sin compañero de respaldo es el caso
        // más urgente de este módulo (la tarea de riesgo queda sin nadie
        // calificado hasta que un admin actúe).
        await publishUnifiedAlert(supabase, {
          sourceModule: "wellbeing_chemical",
          sourceTable: "wellbeing_chemical_alerts",
          sourceId: alert.id as string,
          tier: "respond_10min",
          severity: "p1_urgent",
          title: "Reasignación química sin respaldo disponible",
          summary: "El empleado reportado quedó restringido a tareas de bajo riesgo; nadie más en la orden puede asumir la tarea química.",
        });
        escalatedNoBackup++;
      } else {
        reassignedWithBackup++;
      }

      await supabase
        .from("wellbeing_chemical_alerts")
        .update({
          resolution: "auto_reassigned",
          auto_reassigned_at: now,
          reassigned_employee_id: resolution.backupEmployeeId,
          escalated_no_backup: resolution.escalateToAdmin,
        })
        .eq("id", alert.id);
    }

    return NextResponse.json(
      {
        processed: expired.length,
        checked: (pending || []).length,
        reassignedWithBackup,
        escalatedNoBackup,
        skippedNoAssignment,
      },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

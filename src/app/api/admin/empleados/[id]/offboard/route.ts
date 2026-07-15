import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdminRole } from "@/lib/admin";

/**
 * POST /api/admin/empleados/[id]/offboard — FIX-11: offboarding real.
 *
 * v8.3 hallazgo de auditoría de ciclo de vida del empleado: ningún endpoint
 * en todo el sistema ponía employees.is_active en false -- no existía forma
 * de dar de baja a un empleado desde el producto (análogo al hallazgo de
 * FIX-10 con onboarding). Este endpoint hace las 4 cosas que el "último día"
 * de un empleado real requiere, en una sola transacción de aplicación:
 *
 *   1. Desactivación: employees.is_active=false, terminated_at, termination_reason.
 *   2. Pago final: paga el Vacation Pay acumulado del año (payroll_ytd,
 *      migración 052) vía employee_final_payouts (migración 177), que
 *      payroll-export ya funde al ciclo (mismo patrón que sick leave /
 *      stat holiday de FIX-4).
 *   3. Revocación de acceso: banea la cuenta auth (Supabase admin API) --
 *      is_active=false ya bloquea el dispatch, pero no bloqueaba el login
 *      ni la sesión activa de la PWA.
 *   4. Reasignación: los servicios futuros ya asignados a este empleado
 *      (orders.service_date >= hoy, no completados) se sueltan (soft-delete
 *      de la fila en `assignments`) para que dispatch-scheduler los vuelva a
 *      proponer con otro equipo la próxima vez que corra para esa fecha, y
 *      deja un ticket en la bandeja unificada para que el admin no dependa
 *      solo del cron si la fecha es próxima.
 *
 * Body: { terminationReason: string, terminationDate?: string (YYYY-MM-DD, default hoy) }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdminRole("employees_admin", {
    method: request.method,
    url: request.url,
  });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  try {
    const employeeId = params.id;
    const body = await request.json();
    const { terminationReason, terminationDate } = body as {
      terminationReason?: unknown;
      terminationDate?: unknown;
    };

    if (typeof terminationReason !== "string" || !terminationReason.trim()) {
      return NextResponse.json({ error: "terminationReason is required" }, { status: 400 });
    }

    const supabase = auth.supabase;
    const todayIso = new Date().toISOString().split("T")[0];
    const effectiveDate = typeof terminationDate === "string" ? terminationDate : todayIso;

    const { data: employee, error: employeeError } = await supabase
      .from("employees")
      .select("id, user_id, is_active, terminated_at")
      .eq("id", employeeId)
      .is("deleted_at", null)
      .single();

    if (employeeError || !employee) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    if (employee.terminated_at) {
      return NextResponse.json({ error: "Employee already offboarded" }, { status: 409 });
    }

    // --- 2. Pago final: Vacation Pay acumulado del año en curso ---
    const calendarYear = Number(effectiveDate.slice(0, 4));
    const { data: ytdRow } = await supabase
      .from("payroll_ytd")
      .select("ytd_vacation_pay_accrued_cents")
      .eq("employee_id", employeeId)
      .eq("calendar_year", calendarYear)
      .maybeSingle();

    const vacationPayoutCents = ytdRow?.ytd_vacation_pay_accrued_cents ?? 0;
    if (vacationPayoutCents > 0) {
      const { error: payoutError } = await supabase
        .from("employee_final_payouts")
        .upsert(
          {
            employee_id: employeeId,
            payout_type: "vacation_pay_accrual",
            amount_cents: vacationPayoutCents,
            payout_date: effectiveDate,
            source_calendar_year: calendarYear,
            created_by: auth.user.id,
          },
          { onConflict: "employee_id,payout_type,source_calendar_year" }
        );
      if (payoutError) {
        return NextResponse.json({ error: payoutError.message }, { status: 500 });
      }
    }

    // --- 3. Revocación de acceso: banear la cuenta auth ---
    let accessRevoked = false;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (supabaseUrl && supabaseServiceKey && employee.user_id) {
      const adminSupabase = createClient(supabaseUrl, supabaseServiceKey);
      // ~10 años -- Supabase no tiene un "ban permanente" real, este es el
      // equivalente práctico. Reversible por un owner_admin si se re-contrata.
      const { error: banError } = await adminSupabase.auth.admin.updateUserById(employee.user_id, {
        ban_duration: "87600h",
      });
      if (!banError) accessRevoked = true;
      else console.error("Offboarding: failed to revoke auth access:", banError);
    }

    // --- 4. Reasignación: soltar servicios futuros no completados ---
    const { data: futureOrders } = await supabase
      .from("orders")
      .select("id, service_date")
      .gte("service_date", effectiveDate)
      .not("status", "in", "(cancelled,completed)");

    const futureOrderIds = (futureOrders || []).map((o) => o.id);
    let reassignedCount = 0;
    const affectedOrders: { orderId: string; serviceDate: string }[] = [];
    const inProgressOrders: { orderId: string; serviceDate: string; status: string }[] = [];

    if (futureOrderIds.length > 0) {
      const { data: allFutureAssignments } = await supabase
        .from("assignments")
        .select("id, order_id, status")
        .eq("employee_id", employeeId)
        .in("order_id", futureOrderIds)
        .is("deleted_at", null);

      // v8.3 ROUND 2: hallazgo -- la primera versión de este endpoint soltaba
      // TODAS las asignaciones futuras sin distinguir si el empleado ya
      // estaba a mitad de un servicio hoy (en_route/arrived/in_progress).
      // Soltar esa asignación silenciosamente le habría quitado el servicio
      // de encima mientras lo está ejecutando -- ni el cliente ni el admin
      // se enterarían de que quedó sin equipo a medio servicio. Un servicio
      // ya en curso se deja intacto y se reporta aparte para manejo manual
      // del admin (ej. dejar que termine, o reasignar con contexto humano);
      // solo se sueltan automáticamente los que todavía no arrancan.
      const orderDateById = new Map((futureOrders || []).map((o) => [o.id, o.service_date as string]));
      const releasable = (allFutureAssignments || []).filter(
        (a) => !["en_route", "arrived", "in_progress"].includes(a.status)
      );
      const inProgress = (allFutureAssignments || []).filter((a) =>
        ["en_route", "arrived", "in_progress"].includes(a.status)
      );

      for (const a of inProgress) {
        inProgressOrders.push({
          orderId: a.order_id,
          serviceDate: orderDateById.get(a.order_id) || effectiveDate,
          status: a.status,
        });
      }

      const futureAssignments = releasable;
      const assignmentIds = (futureAssignments || []).map((a) => a.id);
      if (assignmentIds.length > 0) {
        const { error: releaseError } = await supabase
          .from("assignments")
          .update({ deleted_at: new Date().toISOString() })
          .in("id", assignmentIds);

        if (releaseError) {
          return NextResponse.json({ error: releaseError.message }, { status: 500 });
        }
        reassignedCount = assignmentIds.length;

        for (const a of futureAssignments || []) {
          affectedOrders.push({ orderId: a.order_id, serviceDate: orderDateById.get(a.order_id) || effectiveDate });
        }

        // Ticket por cada orden liberada -- visibilidad inmediata para el
        // admin, sin depender de que dispatch-scheduler llegue a esa fecha.
        for (const o of affectedOrders) {
          await supabase.from("tickets_disputas").insert({
            order_id: o.orderId,
            employee_id: employeeId,
            type: "discrepancy",
            priority: "high",
            status: "open",
            context: {
              order_id: o.orderId,
              reason: "employee_offboarded_needs_reassignment",
              service_date: o.serviceDate,
              source: "offboarding",
            },
          });
        }
      }

      // Servicios en curso: no se tocan, pero el admin debe saberlo de
      // inmediato -- prioridad más alta porque hay un cliente esperando un
      // servicio con un equipo que está a punto de perder a su empleado.
      for (const o of inProgressOrders) {
        await supabase.from("tickets_disputas").insert({
          order_id: o.orderId,
          employee_id: employeeId,
          type: "discrepancy",
          priority: "high",
          status: "open",
          context: {
            order_id: o.orderId,
            reason: "employee_offboarded_mid_service_needs_manual_handling",
            service_date: o.serviceDate,
            assignment_status: o.status,
            source: "offboarding",
          },
        });
      }
    }

    // --- 1. Desactivación ---
    const { data: updatedEmployee, error: updateError } = await supabase
      .from("employees")
      .update({
        is_active: false,
        terminated_at: new Date().toISOString(),
        termination_reason: terminationReason.trim(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", employeeId)
      .select("id, name, email, is_active, terminated_at, termination_reason")
      .single();

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json(
      {
        employee: updatedEmployee,
        vacationPayoutCents,
        accessRevoked,
        reassignedCount,
        affectedOrders,
        inProgressOrders,
      },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Offboarding error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

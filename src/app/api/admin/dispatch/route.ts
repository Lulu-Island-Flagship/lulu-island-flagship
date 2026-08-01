import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { roleAllows } from "@/lib/admin-rbac";
import { calculateTeamRequirements, getHHEForRange, type ServiceType } from "@/lib/pricing";
import { evaluateWorkday, type WorkBlock } from "@/lib/workday";
import { evaluateScheduleChange, classifySchedule, calculateContingencyGuaranteedPay, type ScheduleBlock } from "@/lib/schedule-7030";

/**
 * POST /api/admin/dispatch
 *
 * Asigna uno o más empleados a una orden. Reemplaza asignaciones previas
 * para la orden (modelo de equipo limpio: un conjunto de empleados por servicio).
 * Valida N mínimo/máximo según HHE.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("dispatch", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json(
      { error: auth.error || "Unauthorized" },
      { status: auth.status || 401 }
    );
  }

  try {
    const body = await request.json();
    const { orderId, employeeIds, notes, isValidatedEmergency } = body;

    if (!orderId || !Array.isArray(employeeIds) || employeeIds.length === 0) {
      return NextResponse.json(
        { error: "orderId and employeeIds[] are required" },
        { status: 400 }
      );
    }

    // Verificar que la orden existe y traer datos de quote para HHE
    const { data: order, error: orderError } = await auth.supabase
      .from("orders")
      .select("id, status, quote_id, service_date")
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      return NextResponse.json(
        { error: "Order not found" },
        { status: 404 }
      );
    }

    // A-9 fix (auditoría 2026-07-21): el guard original no cubría 'no_show'
    // -- se podía redespachar una orden ya marcada no-show, contradiciendo
    // el flujo de recuperación dedicado de cron/no-show.
    if (order.status === "cancelled" || order.status === "completed" || order.status === "no_show") {
      return NextResponse.json(
        { error: `Cannot dispatch a ${order.status} order` },
        { status: 400 }
      );
    }

    // v8.3 E3 (schedule-7030.ts, modelo 70/30) — "Cambios post-5:30 PM solo
    // emergencias validadas". Este endpoint es el único punto de escritura
    // real de un cambio de equipo fuera del propio scheduler automático
    // (POST /api/admin/dispatch ya marca locked_by_admin=true para que el
    // publicador de las 5:30 PM nunca lo pise) -- evaluateScheduleChange
    // existía testeada pero ningún caller la invocaba todavía. Solo aplica
    // si YA existía una asignación previa para esta orden (un cambio real,
    // no la primera asignación del día).
    const { data: existingAssignmentRows } = await auth.supabase
      .from("assignments")
      .select("id")
      .eq("order_id", orderId)
      .is("deleted_at", null)
      .limit(1);
    const isChangeToExistingAssignment = (existingAssignmentRows?.length ?? 0) > 0;

    if (isChangeToExistingAssignment && order.service_date) {
      const changeDecision = evaluateScheduleChange({
        serviceDateISO: order.service_date as string,
        requestedAt: new Date(),
        isValidatedEmergency: isValidatedEmergency === true,
      });
      if (!changeDecision.allowed) {
        return NextResponse.json(
          {
            error: `Cambio de horario rechazado: ${changeDecision.reason}`,
            cutoff: changeDecision.cutoff,
          },
          { status: 409 }
        );
      }
    }

    // Calcular N mínimo/máximo según HHE
    const { data: quote, error: quoteError } = await auth.supabase
      .from("quotes")
      .select("service_type, square_feet")
      .eq("id", order.quote_id)
      .single();

    if (quoteError || !quote) {
      return NextResponse.json(
        { error: "Quote not found for this order" },
        { status: 404 }
      );
    }

    const serviceType = quote.service_type as ServiceType;
    const squareFeet = quote.square_feet as number;
    const { minTeams, maxTeams } = calculateTeamRequirements(serviceType, squareFeet, "b2c");

    if (employeeIds.length < minTeams) {
      return NextResponse.json(
        { error: `This service requires at least ${minTeams} team member(s) based on estimated labor.` },
        { status: 400 }
      );
    }
    if (employeeIds.length > maxTeams) {
      return NextResponse.json(
        { error: `This service should not exceed ${maxTeams} team member(s) based on estimated labor.` },
        { status: 400 }
      );
    }

    // Verificar que los empleados existen y están activos
    const { data: employees, error: empError } = await auth.supabase
      .from("employees")
      .select("id, is_active")
      .in("id", employeeIds);

    if (empError) {
      console.error("Dispatch employees fetch error:", empError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    const foundIds = new Set((employees || []).map((e) => e.id));
    const missing = employeeIds.filter((id: string) => !foundIds.has(id));
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Employee(s) not found: ${missing.join(", ")}` },
        { status: 404 }
      );
    }

    const inactive = (employees || []).filter((e) => !e.is_active).map((e) => e.id);
    if (inactive.length > 0) {
      return NextResponse.json(
        { error: `Employee(s) inactive: ${inactive.join(", ")}` },
        { status: 400 }
      );
    }

    // A-9 fix (auditoría 2026-07-21): antes esto era un .delete() físico sin
    // filtro de estado -- si un empleado ya estaba 'in_progress' en el
    // servicio, su fila desaparecía sin aviso y no podía cerrar el servicio
    // (t_out no tiene fila de assignment que actualizar).
    //
    // Fix (auditoría externa, hallazgo confirmado -- concurrencia): el check
    // de 'in_progress' + el soft-delete de las asignaciones activas + el
    // insert de las nuevas eran 3 llamadas separadas sin ningún lock. Dos
    // admins redespachando la MISMA orden casi al mismo tiempo (o un admin
    // y el publicador automático de las 5:30 PM) podían dejarla con DOS
    // equipos "pending" simultáneos. Ahora los 3 pasos corren dentro de
    // redispatch_order_atomic (migración 287), que toma
    // `SELECT ... FOR UPDATE` sobre las filas activas de esta orden para
    // serializar redespachos concurrentes -- el segundo que llegue espera a
    // que el primero termine y ve el estado ya actualizado.
    const { data: inserted, error: rpcError } = await auth.supabase.rpc("redispatch_order_atomic", {
      p_order_id: orderId,
      p_employee_ids: employeeIds,
      p_notes: notes || null,
      p_locked_by: auth.user.id,
    });

    if (rpcError) {
      // 55000 (object_not_in_prerequisite_state): la función encontró una
      // asignación 'in_progress' -- mismo caso que antes devolvía 409.
      if (rpcError.code === "55000") {
        return NextResponse.json(
          {
            error:
              "Cannot redispatch: this order has an assignment already in_progress. Resolve or close it before reassigning the team.",
          },
          { status: 409 }
        );
      }
      console.error("Dispatch redispatch_order_atomic error:", rpcError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json(
      {
        orderId,
        assignments: inserted || [],
        assignedCount: inserted?.length || 0,
      },
      { status: 201 }
    );
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Dispatch error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/admin/dispatch?date=YYYY-MM-DD
 *
 * v8.3 E3 (D.4, wireframe aprobado 2026-07-14) — datos para la pantalla de
 * revisión/override del admin: las órdenes del día con su asignación ACTUAL
 * (tabla `assignments`, tal como quedó tras el último ciclo del scheduler o
 * un override manual previo), match de idioma cliente-vs-equipo, y un
 * resumen de jornada acumulada por empleado (evaluateWorkday) cruzando
 * TODAS sus órdenes del día -- no solo la que se está mirando.
 *
 * Límite honesto de alcance: el tránsito real (Google Maps Distance Matrix,
 * C.1) no está cableado a esta pantalla todavía -- se usa el mismo
 * placeholder fijo de 30 min/orden que ya usa dispatch-scheduler
 * internamente (ver buildProposals), NUNCA un número inventado con más
 * precisión de la que hay. El semáforo de tránsito real queda pendiente de
 * esa integración.
 *
 * Si el día pedido todavía no tiene ninguna asignación persistida (p. ej.
 * "mañana" antes de las 5:30 PM, cuando el scheduler solo calcula la
 * propuesta en memoria y no la guarda hasta publicar), la respuesta lo dice
 * explícitamente (`scheduled: false`) en vez de fingir una propuesta.
 */
const PLACEHOLDER_TRANSIT_MINUTES = 30;

export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("dispatch", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }
  const { supabase } = auth;

  try {
    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get("date");
    const targetDate = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
      ? dateParam
      : new Date().toISOString().split("T")[0];

    const { data: orders, error: ordersError } = await supabase
      .from("orders")
      .select("id, user_id, quote_id, service_time, status")
      .eq("service_date", targetDate)
      .neq("status", "cancelled")
      .order("service_time", { ascending: true });

    if (ordersError) {
      console.error("admin/dispatch error:", ordersError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    if (!orders || orders.length === 0) {
      return NextResponse.json({ date: targetDate, scheduled: false, orders: [], employeeWorkdays: [] }, { status: 200 });
    }

    const quoteIds = orders.map((o) => o.quote_id);
    const { data: quotes } = await supabase
      .from("quotes")
      .select("id, service_type, square_feet, zone, address")
      .in("id", quoteIds);
    const quoteMap = new Map((quotes || []).map((q) => [q.id, q]));

    const userIds = Array.from(new Set(orders.map((o) => o.user_id)));
    const { data: clientProfiles } = await supabase
      .from("client_profiles")
      .select("user_id, preferred_languages")
      .in("user_id", userIds);
    const langMap = new Map(
      (clientProfiles || []).map((p) => [p.user_id, (p.preferred_languages as string[]) ?? ["en"]])
    );

    const orderIds = orders.map((o) => o.id);
    const { data: assignmentRows } = await supabase
      .from("assignments")
      .select("id, order_id, employee_id, status, locked_by_admin, notes, assigned_at")
      .in("order_id", orderIds)
      .is("deleted_at", null);

    const employeeIds = Array.from(new Set((assignmentRows || []).map((a) => a.employee_id)));
    const { data: employees } = employeeIds.length > 0
      ? await supabase
          .from("employees")
          .select("id, name, role, languages, trust_level, is_active, day_rate")
          .in("id", employeeIds)
      : { data: [] as never[] };
    const employeeMap = new Map((employees || []).map((e) => [e.id, e]));

    const assignmentsByOrder = new Map<string, typeof assignmentRows>();
    for (const a of assignmentRows || []) {
      const list = assignmentsByOrder.get(a.order_id) || [];
      list.push(a);
      assignmentsByOrder.set(a.order_id, list);
    }

    const scheduled = (assignmentRows || []).length > 0;

    // v8.3 B.2.14/15 -- jornada por empleado, cruzando TODAS sus órdenes del
    // día (no solo una), con el mismo placeholder de tránsito que
    // dispatch-scheduler para no divergir en el cálculo.
    const blocksByEmployee = new Map<string, WorkBlock[]>();

    // v8.3 E3 (schedule-7030.ts, modelo 70/30) -- classifySchedule/
    // calculateContingencyGuaranteedPay existían testeadas pero ningún
    // caller real las invocaba. Aquí se usan para dar visibilidad al admin
    // de qué parte del día de cada empleado quedó fijada con >=5 días de
    // antelación (Horario Base) vs. dentro de la Ventana de Contingencia, y
    // cuánto se le debe garantizar por esa ventana aunque no se le asigne
    // trabajo. `advanceNoticeDays` se deriva de assignments.assigned_at vs.
    // la fecha del servicio -- no existe todavía una tabla de horario
    // semanal separada de `assignments` (ver auditoría), así que esta es la
    // mejor señal real disponible en el esquema actual.
    const scheduleBlocksByEmployee = new Map<string, ScheduleBlock[]>();

    const orderSummaries = orders.map((order) => {
      const quote = quoteMap.get(order.quote_id);
      const serviceType = (quote?.service_type as ServiceType) ?? "regular";
      const squareFeet = (quote?.square_feet as number) ?? 0;
      const hheHours = quote ? getHHEForRange(serviceType, squareFeet) : 0;
      const { minTeams, maxTeams } = quote
        ? calculateTeamRequirements(serviceType, squareFeet, "b2c")
        : { minTeams: 1, maxTeams: 3 };

      const assignments = (assignmentsByOrder.get(order.id) || []).map((a) => {
        const emp = employeeMap.get(a.employee_id);
        return {
          assignmentId: a.id,
          employeeId: a.employee_id,
          name: emp?.name ?? "Unknown",
          role: emp?.role ?? null,
          languages: (emp?.languages as string[] | undefined) ?? [],
          trustLevel: emp?.trust_level ?? null,
          isActive: emp?.is_active ?? null,
          status: a.status,
          lockedByAdmin: a.locked_by_admin ?? false,
        };
      });

      if (assignments.length > 0) {
        // Fix (auditoría externa, hallazgo confirmado): antes se calculaba
        // perPersonMinutes = Math.round((hheHours/N)*60) UNA vez y se le
        // asignaba el mismo valor a los N empleados -- con N>1 y hheHours no
        // divisible exacto, la suma de los N perPersonMinutes puede no
        // coincidir con el total HHE del servicio en minutos (ej. 100 min /
        // 3 = 33.33 -> Math.round da 33 a los 3 -> suma 99, se pierde 1
        // minuto de jornada real). Se calcula el total en minutos UNA sola
        // vez (redondeado una sola vez, no N veces) y se reparte en enteros;
        // el residuo de la división entera lo absorbe el último empleado de
        // la lista para que la suma siempre cuadre exacto con el total.
        const totalServiceMinutes = Math.round(hheHours * 60);
        const perPersonBaseMinutes = Math.floor(totalServiceMinutes / assignments.length);
        const minutesRemainder = totalServiceMinutes - perPersonBaseMinutes * assignments.length;
        const rawAssignments = assignmentsByOrder.get(order.id) || [];
        assignments.forEach((a, idx) => {
          const perPersonMinutes =
            perPersonBaseMinutes + (idx === assignments.length - 1 ? minutesRemainder : 0);
          const list = blocksByEmployee.get(a.employeeId) || [];
          list.push({ serviceMinutes: perPersonMinutes, transitMinutes: PLACEHOLDER_TRANSIT_MINUTES });
          blocksByEmployee.set(a.employeeId, list);

          const rawRow = rawAssignments.find((r) => r.id === a.assignmentId);
          const assignedAt = rawRow?.assigned_at ? new Date(rawRow.assigned_at as string) : null;
          const serviceDate = new Date(`${targetDate}T00:00:00`);
          const advanceNoticeDays = assignedAt
            ? Math.max(0, Math.floor((serviceDate.getTime() - assignedAt.getTime()) / (24 * 60 * 60 * 1000)))
            : 0;
          const scheduleList = scheduleBlocksByEmployee.get(a.employeeId) || [];
          scheduleList.push({
            id: a.assignmentId,
            dayOfWeek: serviceDate.getDay(),
            durationMinutes: perPersonMinutes + PLACEHOLDER_TRANSIT_MINUTES,
            advanceNoticeDays,
          });
          scheduleBlocksByEmployee.set(a.employeeId, scheduleList);
        });
      }

      const clientLanguages = langMap.get(order.user_id) ?? ["en"];
      const assignedLanguages = new Set(assignments.flatMap((a) => a.languages));
      const languageMatch = assignments.length === 0
        ? "unassigned"
        : clientLanguages.some((l) => assignedLanguages.has(l))
          ? "match"
          : "no_match";

      return {
        orderId: order.id,
        serviceTime: order.service_time,
        status: order.status,
        serviceType,
        squareFeet,
        zone: quote?.zone ?? null,
        hheHours,
        minTeams,
        maxTeams,
        clientLanguages,
        languageMatch,
        assignments,
      };
    });

    const employeeWorkdays = Array.from(blocksByEmployee.entries()).map(([employeeId, blocks]) => {
      const emp = employeeMap.get(employeeId);
      const evaluation = evaluateWorkday(blocks);
      return {
        employeeId,
        name: emp?.name ?? "Unknown",
        ordersCount: blocks.length,
        totalDayMinutes: evaluation.totalDayMinutes,
        status: evaluation.status,
        reasons: evaluation.reasons,
      };
    });

    // v8.3 E3 (schedule-7030.ts) -- clasificación 70/30 + pago garantizado de
    // la Ventana de Contingencia, por empleado, para el día consultado.
    // day_rate (employees.day_rate, "$CAD diarios (modelo 70/30)") se
    // convierte a tarifa por hora asumiendo jornada de 8h -- no existe un
    // hourly_rate propio en el esquema, y day_rate/8 es la única conversión
    // que no inventa un número nuevo.
    //
    // Fix auditoría 2026-07-30: el recurso RBAC de este endpoint es
    // "dispatch" (owner_admin + ops_coordinator, ver admin-rbac.ts), no
    // "payroll" (solo owner_admin) -- pero guaranteedContingencyPayCents es
    // un monto en dólares derivado directamente de employees.day_rate, así
    // que devolverlo aquí filtraba información salarial a cualquier
    // ops_coordinator con acceso normal a dispatch. day_rate se sigue
    // leyendo y usando server-side (línea ~310, necesario para el cálculo),
    // pero el monto derivado solo se incluye en la respuesta si el rol que
    // hizo la request también tiene acceso a "payroll".
    const hasPayrollAccess = roleAllows(auth.roles, "payroll");
    const scheduleCompliance = Array.from(scheduleBlocksByEmployee.entries()).map(([employeeId, blocks]) => {
      const emp = employeeMap.get(employeeId);
      const classification = classifySchedule(blocks);
      // Fix (auditoría externa, hallazgo confirmado): antes, si `emp` no se
      // encontraba en employeeMap (dato inconsistente -- no debería pasar en
      // el flujo normal, pero no está garantizado), se usaba un default
      // hardcodeado de $200/día tomado del DEFAULT de la columna
      // employees.day_rate (migración 003) para calcular un monto real de
      // pago garantizado (guaranteedContingencyPayCents). Eso inventaba una
      // cifra de dinero para un empleado del que en realidad no se pudo leer
      // la tarifa real -- en vez de eso, se excluye el monto y se marca
      // explícitamente `dayRateUnavailable: true` para que el admin sepa que
      // debe verificar el registro del empleado antes de confiar en el pago
      // garantizado mostrado (o su ausencia).
      const rawDayRate = (emp as { day_rate?: number } | undefined)?.day_rate;
      const dayRateUnavailable = typeof rawDayRate !== "number";
      const dayRate = dayRateUnavailable ? null : rawDayRate;
      const guaranteedContingencyPayCents = dayRate === null
        ? null
        : calculateContingencyGuaranteedPay(
            classification.contingencyMinutes,
            Math.round((dayRate * 100) / 8)
          );
      return {
        employeeId,
        name: emp?.name ?? "Unknown",
        baseMinutes: classification.baseMinutes,
        contingencyMinutes: classification.contingencyMinutes,
        expectedBaseMinutes: classification.expectedBaseMinutes,
        expectedContingencyMinutes: classification.expectedContingencyMinutes,
        withinTolerance: classification.withinTolerance,
        deviationReasons: classification.deviationReasons,
        ...(hasPayrollAccess ? { guaranteedContingencyPayCents, dayRateUnavailable } : {}),
      };
    });

    return NextResponse.json(
      {
        date: targetDate,
        scheduled,
        transitMinutesIsPlaceholder: true,
        orders: orderSummaries,
        employeeWorkdays,
        scheduleCompliance,
      },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Dispatch GET error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

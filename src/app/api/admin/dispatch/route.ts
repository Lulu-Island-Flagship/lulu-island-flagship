import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { calculateTeamRequirements, getHHEForRange, type ServiceType } from "@/lib/pricing";
import { evaluateWorkday, type WorkBlock } from "@/lib/workday";

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
    const { orderId, employeeIds, notes } = body;

    if (!orderId || !Array.isArray(employeeIds) || employeeIds.length === 0) {
      return NextResponse.json(
        { error: "orderId and employeeIds[] are required" },
        { status: 400 }
      );
    }

    // Verificar que la orden existe y traer datos de quote para HHE
    const { data: order, error: orderError } = await auth.supabase
      .from("orders")
      .select("id, status, quote_id")
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      return NextResponse.json(
        { error: "Order not found" },
        { status: 404 }
      );
    }

    if (order.status === "cancelled" || order.status === "completed") {
      return NextResponse.json(
        { error: `Cannot dispatch a ${order.status} order` },
        { status: 400 }
      );
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
      return NextResponse.json({ error: empError.message }, { status: 500 });
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

    // Transacción: eliminar asignaciones previas e insertar nuevas
    const { error: deleteError } = await auth.supabase
      .from("assignments")
      .delete()
      .eq("order_id", orderId);

    if (deleteError) {
      console.error("Dispatch delete error:", deleteError);
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    // v8.3 E3/D.4 (migración 140): marcar como decisión humana explícita
    // para que el publicador automático de las 5:30 PM (persistAssignments
    // en /api/cron/dispatch-scheduler) NUNCA la borre ni la reemplace.
    const assignments = employeeIds.map((employeeId: string) => ({
      order_id: orderId,
      employee_id: employeeId,
      status: "pending" as const,
      notes: notes || null,
      locked_by_admin: true,
      locked_by: auth.user.id,
      locked_at: new Date().toISOString(),
    }));

    const { data: inserted, error: insertError } = await auth.supabase
      .from("assignments")
      .insert(assignments)
      .select("id, order_id, employee_id, status, assigned_at, notes");

    if (insertError) {
      console.error("Dispatch insert error:", insertError);
      return NextResponse.json({ error: insertError.message }, { status: 500 });
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
      return NextResponse.json({ error: ordersError.message }, { status: 500 });
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
      .select("id, order_id, employee_id, status, locked_by_admin, notes")
      .in("order_id", orderIds)
      .is("deleted_at", null);

    const employeeIds = Array.from(new Set((assignmentRows || []).map((a) => a.employee_id)));
    const { data: employees } = employeeIds.length > 0
      ? await supabase
          .from("employees")
          .select("id, name, role, languages, trust_level, is_active")
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
        const perPersonMinutes = Math.round((hheHours / assignments.length) * 60);
        for (const a of assignments) {
          const list = blocksByEmployee.get(a.employeeId) || [];
          list.push({ serviceMinutes: perPersonMinutes, transitMinutes: PLACEHOLDER_TRANSIT_MINUTES });
          blocksByEmployee.set(a.employeeId, list);
        }
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

    return NextResponse.json(
      {
        date: targetDate,
        scheduled,
        transitMinutesIsPlaceholder: true,
        orders: orderSummaries,
        employeeWorkdays,
      },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Dispatch GET error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

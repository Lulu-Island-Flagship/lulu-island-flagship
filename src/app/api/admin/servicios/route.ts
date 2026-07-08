import { NextResponse } from "next/server";
import { requireSupervisor } from "@/lib/admin";

// GET /api/admin/servicios — servicios de hoy con % de checklist completado
export async function GET() {
  const auth = await requireSupervisor();
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  try {
    // Calcular "hoy" en la zona horaria del negocio (America/Vancouver)
    // toLocaleString con en-CA devuelve YYYY-MM-DD, HH:MM:SS — tomamos solo la parte de fecha
    const vancouverDate = new Date().toLocaleString("en-CA", {
      timeZone: "America/Vancouver",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const today = vancouverDate.split(",")[0]; // formato YYYY-MM-DD

    // También devolver la fecha para diagnóstico
    const utcDate = new Date().toISOString().split("T")[0];

    // Obtener órdenes de hoy
    const { data: orders, error: ordersError } = await auth.supabase
      .from("orders")
      .select("id, service_date, service_time, status, quote_id")
      .eq("service_date", today)
      .order("service_time", { ascending: true });

    if (ordersError) {
      console.error("Orders fetch error:", ordersError);
      return NextResponse.json({ error: ordersError.message }, { status: 500 });
    }

    const orderIds = (orders || []).map((o: { id: string }) => o.id);
    const quoteIds = (orders || [])
      .map((o: { quote_id: string }) => o.quote_id)
      .filter(Boolean);

    // Obtener quotes asociadas en query separada (evita problemas de join + RLS)
    const { data: quotes, error: quotesError } = await auth.supabase
      .from("quotes")
      .select("id, service_type, address, zone, bedrooms, bathrooms, square_feet, total")
      .in("id", quoteIds.length > 0 ? quoteIds : ["00000000-0000-0000-0000-000000000000"]);

    if (quotesError) {
      console.error("Quotes fetch error:", quotesError);
    }

    const quoteMap = new Map();
    for (const q of quotes || []) {
      quoteMap.set(q.id, q);
    }

    // Obtener assignments para estas órdenes
    const { data: assignments, error: assignError } = await auth.supabase
      .from("assignments")
      .select("id, order_id, employee_id, status, assigned_at, notes")
      .in("order_id", orderIds);

    if (assignError) {
      console.error("Assignments fetch error:", assignError);
    }

    // Obtener nombres de empleados
    const employeeIds = (assignments || [])
      .map((a: { employee_id: string }) => a.employee_id)
      .filter(Boolean);

    const { data: employees } = await auth.supabase
      .from("employees")
      .select("id, name, email")
      .in("id", employeeIds.length > 0 ? employeeIds : ["00000000-0000-0000-0000-000000000000"]);

    const employeeMap = new Map();
    for (const e of employees || []) {
      employeeMap.set(e.id, e);
    }

    const assignmentMap = new Map<string, typeof assignments>();
    for (const a of assignments || []) {
      const list = assignmentMap.get(a.order_id) || [];
      list.push(a);
      assignmentMap.set(a.order_id, list);
    }

    // Obtener checklists completados por orden
    const { data: checklistItems } = await auth.supabase
      .from("service_checklist_items")
      .select("order_id, is_completed")
      .in("order_id", orderIds.length > 0 ? orderIds : ["00000000-0000-0000-0000-000000000000"]);

    const completedCountByOrder = new Map<string, number>();
    for (const item of checklistItems || []) {
      if (item.is_completed) {
        completedCountByOrder.set(
          item.order_id,
          (completedCountByOrder.get(item.order_id) || 0) + 1
        );
      }
    }

    // Obtener plantillas de checklist para calcular totales por service_subtype
    const { data: checklists } = await auth.supabase
      .from("sop_checklists")
      .select("id, service_subtype, items")
      .eq("is_active", true);

    // Enriquecer datos
    const enriched = [];
    for (const o of orders || []) {
      const quote = o.quote_id ? quoteMap.get(o.quote_id) : null;
      const orderAssignments = assignmentMap.get(o.id) || [];
      const employeeNames = orderAssignments.length > 0
        ? orderAssignments.map((a) => employeeMap.get(a.employee_id)?.name || "Unknown").join(", ")
        : "Unassigned";
      const employeeEmails = orderAssignments.length > 0
        ? orderAssignments.map((a) => employeeMap.get(a.employee_id)?.email || "").filter(Boolean).join(", ")
        : "";
      // Status consolidado: si hay múltiples asignaciones, usa el más avanzado
      const statusPriority = ["completed", "in_progress", "arrived", "en_route", "pending", "cancelled", "no_show"];
      const assignmentStatus = orderAssignments.length > 0
        ? statusPriority.find((s) => orderAssignments.some((a) => a.status === s)) || "pending"
        : "pending";
      const serviceSubtype = quote?.service_type === "deep" ? "first_time" : (quote?.service_type || "regular");
      const completedItems = completedCountByOrder.get(o.id) || 0;
      // Calculate total from active zones for this service subtype
      let totalItems = 0;
      for (const cl of checklists || []) {
        if (cl.service_subtype === serviceSubtype) {
          totalItems += (cl.items || []).filter((item: { active?: boolean }) => item.active !== false).length;
        }
      }
      const percentComplete = totalItems > 0 ? Math.min(100, Math.round((completedItems / totalItems) * 100)) : 0;

      enriched.push({
        orderId: o.id,
        serviceDate: o.service_date,
        serviceTime: o.service_time,
        orderStatus: o.status,
        assignmentStatus,
        employeeName: employeeNames,
        employeeEmail: employeeEmails,
        address: quote?.address || "",
        zone: quote?.zone || "",
        serviceType: quote?.service_type || "",
        serviceSubtype,
        bedrooms: quote?.bedrooms || 0,
        bathrooms: quote?.bathrooms || 0,
        squareFeet: quote?.square_feet || 0,
        total: quote?.total || 0,
        completedItems,
        totalItems,
        percentComplete,
        assignments: orderAssignments.map((a) => ({
          assignmentId: a.id,
          employeeId: a.employee_id,
          employeeName: employeeMap.get(a.employee_id)?.name || "Unknown",
          status: a.status,
          assignedAt: a.assigned_at,
          notes: a.notes,
        })),
      });
    }

    return NextResponse.json({ services: enriched, today, utcDate }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Admin services error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

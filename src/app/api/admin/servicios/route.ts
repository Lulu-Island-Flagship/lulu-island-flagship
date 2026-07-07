import { NextResponse } from "next/server";
import { requireSupervisor } from "@/lib/admin";

// GET /api/admin/servicios — servicios de hoy con % de checklist completado
export async function GET() {
  const auth = await requireSupervisor();
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Calcular "hoy" en la zona horaria del negocio (America/Vancouver)
    const vancouverDate = new Date().toLocaleString("en-CA", {
      timeZone: "America/Vancouver",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const today = vancouverDate; // formato YYYY-MM-DD

    // También devolver la fecha para diagnóstico
    const utcDate = new Date().toISOString().split("T")[0];

    // Obtener órdenes de hoy con quotes y assignments
    const { data: orders, error: ordersError } = await supabase
      .from("orders")
      .select(`
        id,
        service_date,
        service_time,
        status,
        quote_id,
        quotes:quote_id (
          id,
          service_type,
          address,
          zone,
          bedrooms,
          bathrooms,
          square_feet,
          total
        )
      `)
      .eq("service_date", today)
      .order("service_time", { ascending: true });

    if (ordersError) {
      console.error("Orders fetch error:", ordersError);
      return NextResponse.json({ error: ordersError.message }, { status: 500 });
    }

    const orderIds = (orders || []).map((o: { id: string }) => o.id);
    // quoteIds no se necesita directamente — los datos vienen del join en orders.quotes
    void orderIds;

    // Obtener assignments para estas órdenes
    const { data: assignments, error: assignError } = await supabase
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

    const { data: employees } = await supabase
      .from("employees")
      .select("id, name, email")
      .in("id", employeeIds.length > 0 ? employeeIds : ["00000000-0000-0000-0000-000000000000"]);

    const employeeMap = new Map();
    for (const e of employees || []) {
      employeeMap.set(e.id, e);
    }

    const assignmentMap = new Map();
    for (const a of assignments || []) {
      assignmentMap.set(a.order_id, a);
    }

    // Obtener checklists completados por orden
    const { data: checklistItems } = await supabase
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

    // Obtener plantillas de checklist para calcular totales
    const { data: checklists } = await supabase
      .from("sop_checklists")
      .select("service_subtype, items")
      .eq("is_active", true);

    const checklistTotalBySubtype = new Map<string, number>();
    for (const cl of checklists || []) {
      const count = (cl.items || []).length;
      checklistTotalBySubtype.set(cl.service_subtype, count);
    }

    // Enriquecer datos
    const enriched = [];
    for (const o of orders || []) {
      // Supabase join devuelve array, tomamos el primer elemento
      const quoteArr = o.quotes as Array<{ service_type: string; address: string; zone: string; bedrooms: number; bathrooms: number; square_feet: number; total: number }> | null;
      const quote = quoteArr && quoteArr.length > 0 ? quoteArr[0] : null;
      const assignment = assignmentMap.get(o.id);
      const employee = assignment ? employeeMap.get(assignment.employee_id) : null;
      const serviceSubtype = quote?.service_type === "deep" ? "first_time" : (quote?.service_type || "regular");
      const completedItems = completedCountByOrder.get(o.id) || 0;
      const totalItems = checklistTotalBySubtype.get(serviceSubtype) || 0;
      const percentComplete = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

      enriched.push({
        orderId: o.id,
        serviceDate: o.service_date,
        serviceTime: o.service_time,
        orderStatus: o.status,
        assignmentStatus: assignment?.status || "pending",
        employeeName: employee?.name || "Unassigned",
        employeeEmail: employee?.email || "",
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
      });
    }

    return NextResponse.json({ services: enriched, today, utcDate }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Admin services error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

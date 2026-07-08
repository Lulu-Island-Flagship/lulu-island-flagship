import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { calculateTeamRequirements, type ServiceType } from "@/lib/pricing";

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

    const assignments = employeeIds.map((employeeId: string) => ({
      order_id: orderId,
      employee_id: employeeId,
      status: "pending" as const,
      notes: notes || null,
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

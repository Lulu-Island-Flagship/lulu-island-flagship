import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import {
  computeRotationStatus,
  detectPairingExceptionViolations,
  type AssignmentPair,
  type PairingException,
} from "@/lib/coworker-rotation";

/**
 * GET  /api/admin/coworker-rotation?month=YYYY-MM — v8.3 E8.14: estado de
 *      rotación (mínimo 3 compañeros distintos/mes por empleado) +
 *      violaciones de excepciones "nunca juntos". Solo lectura sobre
 *      `assignments` -- no interviene en el motor de dispatch (E3/E4).
 * POST /api/admin/coworker-rotation — { action: "add_exception", employeeAId, employeeBId, reason }
 *      { action: "deactivate_exception", id }
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("dispatch", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;

  const monthParam = request.nextUrl.searchParams.get("month"); // YYYY-MM
  const now = new Date();
  const month = monthParam ?? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const [year, monthNum] = month.split("-").map(Number);
  const monthStart = `${year}-${String(monthNum).padStart(2, "0")}-01`;
  const nextMonth = monthNum === 12 ? `${year + 1}-01-01` : `${year}-${String(monthNum + 1).padStart(2, "0")}-01`;

  const { data: orders, error: ordersError } = await supabase
    .from("orders")
    .select("id, service_date")
    .gte("service_date", monthStart)
    .lt("service_date", nextMonth);

  if (ordersError) {
    console.error("admin/coworker-rotation error:", ordersError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  const orderIds = (orders ?? []).map((o) => o.id);
  const orderDateMap = new Map((orders ?? []).map((o) => [o.id, o.service_date]));

  const { data: assignments, error: assignError } =
    orderIds.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("assignments")
          .select("order_id, employee_id")
          .in("order_id", orderIds)
          .is("deleted_at", null)
          .not("status", "in", "(cancelled)");

  if (assignError) {
    console.error("admin/coworker-rotation error:", assignError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  // Armar pares: dos empleados en la misma orden = trabajaron juntos.
  const byOrder = new Map<string, string[]>();
  for (const a of assignments ?? []) {
    if (!byOrder.has(a.order_id)) byOrder.set(a.order_id, []);
    byOrder.get(a.order_id)!.push(a.employee_id);
  }

  const pairs: AssignmentPair[] = [];
  for (const [orderId, employeeIds] of Array.from(byOrder.entries())) {
    const serviceDate = orderDateMap.get(orderId) ?? monthStart;
    for (let i = 0; i < employeeIds.length; i++) {
      for (let j = i + 1; j < employeeIds.length; j++) {
        pairs.push({ employeeAId: employeeIds[i], employeeBId: employeeIds[j], orderId, serviceDate });
      }
    }
  }

  const { data: exceptionRows, error: exceptionsError } = await supabase
    .from("employee_pairing_exceptions")
    .select("id, employee_a_id, employee_b_id, reason, is_active")
    .is("deleted_at", null)
    .eq("is_active", true);

  if (exceptionsError) {
    console.error("admin/coworker-rotation error:", exceptionsError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  const exceptions: PairingException[] = (exceptionRows ?? []).map((e) => ({
    employeeAId: e.employee_a_id,
    employeeBId: e.employee_b_id,
    reason: e.reason,
  }));

  const rotationStatus = computeRotationStatus(pairs);
  const violations = detectPairingExceptionViolations(pairs, exceptions);

  return NextResponse.json(
    {
      month,
      rotationStatus,
      violations,
      exceptions: exceptionRows ?? [],
    },
    { status: 200 }
  );
}

interface RotationActionBody {
  action?: string;
  employeeAId?: string;
  employeeBId?: string;
  reason?: string;
  id?: string;
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("dispatch", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;

  let body: RotationActionBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (body.action === "add_exception") {
    if (!body.employeeAId || !body.employeeBId || !body.reason?.trim()) {
      return NextResponse.json({ error: "employeeAId, employeeBId y reason son obligatorios" }, { status: 400 });
    }
    if (body.employeeAId === body.employeeBId) {
      return NextResponse.json({ error: "employeeAId y employeeBId deben ser distintos" }, { status: 400 });
    }

    const { data: docBy } = await supabase
      .from("employees")
      .select("id")
      .eq("user_id", auth.user.id)
      .maybeSingle();

    const { data, error } = await supabase
      .from("employee_pairing_exceptions")
      .insert({
        employee_a_id: body.employeeAId,
        employee_b_id: body.employeeBId,
        reason: body.reason.trim(),
        documented_by: docBy?.id ?? null,
      })
      .select()
      .single();

    if (error) {
      console.error("admin/coworker-rotation error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }
    return NextResponse.json({ exception: data }, { status: 201 });
  }

  if (body.action === "deactivate_exception") {
    if (!body.id) return NextResponse.json({ error: "id es obligatorio" }, { status: 400 });

    const { data, error } = await supabase
      .from("employee_pairing_exceptions")
      .update({ is_active: false })
      .eq("id", body.id)
      .select()
      .single();

    if (error) {
      console.error("admin/coworker-rotation error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }
    return NextResponse.json({ exception: data }, { status: 200 });
  }

  return NextResponse.json({ error: "Unrecognized action" }, { status: 400 });
}

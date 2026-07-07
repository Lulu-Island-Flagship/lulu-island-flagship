import { NextRequest, NextResponse } from "next/server";
import { requireSupervisor } from "@/lib/admin";

// GET /api/admin/tickets — cola de tickets priorizada
export async function GET(request: NextRequest) {
  const auth = await requireSupervisor();
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "open";

    const { data, error } = await supabase
      .from("tickets_disputas")
      .select(`
        id,
        order_id,
        employee_id,
        type,
        priority,
        status,
        context,
        resolution_note,
        resolved_by,
        resolved_at,
        created_at,
        employees:employee_id (name),
        orders:order_id (service_date, service_time)
      `)
      .eq("status", status)
      .order("priority", { ascending: false }) // high first
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ tickets: data || [] }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/admin/tickets — crear ticket (admin o sistema)
export async function POST(request: NextRequest) {
  const auth = await requireSupervisor();
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { orderId, employeeId, type, priority, context } = body;

    if (!type || !priority) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("tickets_disputas")
      .insert({
        order_id: orderId || null,
        employee_id: employeeId || null,
        type,
        priority,
        context: context || {},
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ticket: data }, { status: 201 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

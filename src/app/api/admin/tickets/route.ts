import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { safeErrorResponse } from "@/lib/api-errors";

// GET /api/admin/tickets — cola de tickets priorizada
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("tickets", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "open";

    const { data, error } = await auth.supabase
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
      .order("created_at", { ascending: true });

    if (error) {
      console.error("admin/tickets error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    // Fix (auditoría externa, hallazgo confirmado): `priority` es TEXT
    // ('high'/'medium'/'low'), y ordenar por esa columna con
    // `.order("priority", { ascending: false })` es un ORDER BY alfabético
    // en Postgres, no por severidad real -- alfabéticamente "medium" >
    // "low" > "high", así que los tickets de alta prioridad terminaban
    // AL FINAL de la cola en vez de primero. Se reordena en memoria con un
    // mapeo numérico explícito de severidad (mismo criterio real que el
    // nombre de la ruta promete: "cola de tickets priorizada"); created_at
    // asc como desempate ya viene aplicado desde la consulta.
    const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
    const sorted = [...(data || [])].sort((a, b) => {
      const rankA = PRIORITY_RANK[a.priority as string] ?? 99;
      const rankB = PRIORITY_RANK[b.priority as string] ?? 99;
      return rankA - rankB;
    });

    return NextResponse.json({ tickets: sorted }, { status: 200 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

// POST /api/admin/tickets — crear ticket (admin o sistema)
export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("tickets", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  try {
    const body = await request.json();
    const { orderId, employeeId, type, priority, context } = body;

    if (!type || !priority) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const { data, error } = await auth.supabase
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
      console.error("admin/tickets error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json({ ticket: data }, { status: 201 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

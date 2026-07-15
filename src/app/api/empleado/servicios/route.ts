import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder";

function getSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(
    supabaseUrl,
    supabaseKey,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          cookieStore.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          cookieStore.set({ name, value: "", ...options });
        },
      },
    }
  );
}

// GET /api/empleado/servicios — lista de servicios del día para el empleado autenticado
export async function GET() {
  try {
    const supabase = getSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Buscar el perfil de empleado del usuario autenticado
    const { data: employee, error: empError } = await supabase
      .from("employees")
      .select("id, name, role")
      .eq("user_id", user.id)
      .single();

    if (empError || !employee) {
      return NextResponse.json({ error: "Employee profile not found" }, { status: 403 });
    }

    // Calcular "hoy" en la zona horaria del negocio (America/Vancouver)
    const vancouverDate = new Date().toLocaleString("en-CA", {
      timeZone: "America/Vancouver",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const today = vancouverDate.split(",")[0];

    // Paso 1: Buscar asignaciones del empleado para órdenes de hoy o futuras
    // Primero obtener order_ids de órdenes de hoy/futuro, luego filtrar assignments
    // v8.3 fix (auditoría 2026-07-15): esta consulta no excluía órdenes
    // canceladas -- combinado con que /api/orders/[orderId]/cancel nunca
    // marcaba `assignments.status='cancelled'` (ya corregido), un empleado
    // podía ver y desplazarse a un servicio que el cliente ya canceló. Se
    // excluye explícitamente aquí también, como segunda barrera.
    const { data: todaysOrders, error: ordersDateError } = await supabase
      .from("orders")
      .select("id")
      .gte("service_date", today)
      .neq("status", "cancelled")
      .order("service_date", { ascending: true });

    if (ordersDateError) {
      console.error("Orders date fetch error:", ordersDateError);
      return NextResponse.json({ error: ordersDateError.message }, { status: 500 });
    }

    const todaysOrderIds = (todaysOrders || []).map((o) => o.id);

    if (todaysOrderIds.length === 0) {
      return NextResponse.json(
        { services: [], employee: { id: employee.id, name: employee.name, role: employee.role } },
        { status: 200 }
      );
    }

    const { data: assignments, error: assignError } = await supabase
      .from("assignments")
      .select(`
        id,
        order_id,
        status,
        assigned_at,
        notes
      `)
      .is("deleted_at", null)
      .eq("employee_id", employee.id)
      .in("order_id", todaysOrderIds)
      .neq("status", "cancelled")
      .order("created_at", { ascending: true });

    if (assignError) {
      console.error("Assignments fetch error:", assignError);
      return NextResponse.json({ error: assignError.message }, { status: 500 });
    }

    if (!assignments || assignments.length === 0) {
      return NextResponse.json(
        { services: [], employee: { id: employee.id, name: employee.name, role: employee.role } },
        { status: 200 }
      );
    }

    // Paso 2: Obtener los order_ids y buscar las órdenes con sus quotes
    const orderIds = assignments.map((a) => a.order_id);

    const { data: orders, error: ordersError } = await supabase
      .from("orders")
      .select(`
        id,
        service_date,
        service_time,
        status,
        quote_id
      `)
      .in("id", orderIds)
      .gte("service_date", today)
      .order("service_date", { ascending: true })
      .order("service_time", { ascending: true });

    if (ordersError) {
      console.error("Orders fetch error:", ordersError);
      return NextResponse.json({ error: ordersError.message }, { status: 500 });
    }

    // Paso 3: Obtener las quotes asociadas
    const quoteIds = (orders || []).map((o) => o.quote_id).filter(Boolean);

    const { data: quotes, error: quotesError } = await supabase
      .from("quotes")
      .select(`
        id,
        service_type,
        address,
        zone,
        square_feet,
        bedrooms,
        bathrooms,
        pets_count,
        pets_type,
        residents,
        total,
        user_id
      `)
      .in("id", quoteIds);

    if (quotesError) {
      console.error("Quotes fetch error:", quotesError);
      return NextResponse.json({ error: quotesError.message }, { status: 500 });
    }

    // Crear mapas para lookup rápido
    const orderMap = new Map();
    for (const o of orders || []) {
      orderMap.set(o.id, o);
    }

    const quoteMap = new Map();
    for (const q of quotes || []) {
      quoteMap.set(q.id, q);
    }

    // Paso 4: Enriquecer con datos del cliente (nombre/email desde profiles) — batch query, no N+1
    const clientUserIds: string[] = [];
    const seen = new Set<string>();
    for (const q of quotes || []) {
      if (q.user_id && !seen.has(q.user_id)) {
        seen.add(q.user_id);
        clientUserIds.push(q.user_id);
      }
    }
    const profileMap = new Map();
    if (clientUserIds.length > 0) {
      const { data: profilesData } = await supabase
        .from("profiles")
        .select("id, full_name, phone")
        .in("id", clientUserIds);
      for (const p of profilesData || []) {
        profileMap.set(p.id, p);
      }
    }

    const enriched = [];
    for (const a of assignments || []) {
      const order = orderMap.get(a.order_id);
      if (!order) continue;

      const quote = order.quote_id ? quoteMap.get(order.quote_id) : null;
      const profile = quote?.user_id ? profileMap.get(quote.user_id) : null;

      enriched.push({
        assignmentId: a.id,
        orderId: a.order_id,
        status: a.status,
        assignedAt: a.assigned_at,
        notes: a.notes,
        serviceDate: order.service_date,
        serviceTime: order.service_time,
        orderStatus: order.status,
        serviceSubtype: quote?.service_type === 'deep' ? 'first_time' : quote?.service_type,
        address: quote?.address,
        zone: quote?.zone,
        squareFeet: quote?.square_feet,
        bedrooms: quote?.bedrooms,
        bathrooms: quote?.bathrooms,
        petsCount: quote?.pets_count,
        petsType: quote?.pets_type,
        residents: quote?.residents,
        total: quote?.total,
        clientName: profile?.full_name || "",
        clientPhone: profile?.phone || "",
      });
    }

    return NextResponse.json(
      { services: enriched, employee: { id: employee.id, name: employee.name, role: employee.role } },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Employee services error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

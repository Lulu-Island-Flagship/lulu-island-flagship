import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

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

// POST /api/empleado/servicio — T_in, T_start, T_out, foto, nota
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { orderId, eventType, locationLat, locationLng, photoUrl, notes } = body;

    if (!orderId || !eventType) {
      return NextResponse.json({ error: "Missing orderId or eventType" }, { status: 400 });
    }

    const validEvents = ["t_in", "t_start", "t_out", "photo", "note"];
    if (!validEvents.includes(eventType)) {
      return NextResponse.json({ error: `Invalid eventType. Must be one of: ${validEvents.join(", ")}` }, { status: 400 });
    }

    const supabase = getSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Buscar perfil de empleado
    const { data: employee, error: empError } = await supabase
      .from("employees")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (empError || !employee) {
      return NextResponse.json({ error: "Employee profile not found" }, { status: 403 });
    }

    // Verificar que el empleado tiene asignación para este order
    const { data: assignment, error: assignError } = await supabase
      .from("assignments")
      .select("id, status")
      .eq("order_id", orderId)
      .eq("employee_id", employee.id)
      .single();

    if (assignError || !assignment) {
      return NextResponse.json({ error: "No assignment found for this service" }, { status: 403 });
    }

    // Actualizar status de la asignación según el evento (solo para eventos de progreso)
    let newStatus = assignment.status;
    if (eventType === "t_in") newStatus = "arrived";
    if (eventType === "t_start") newStatus = "in_progress";
    if (eventType === "t_out") newStatus = "completed";

    // Validar secuencia: no permitir t_start sin t_in, ni t_out sin t_start
    if (eventType === "t_start" && assignment.status !== "arrived") {
      return NextResponse.json({ error: "Must check in (T_in) before starting service" }, { status: 400 });
    }
    if (eventType === "t_out" && assignment.status !== "in_progress") {
      return NextResponse.json({ error: "Must start service (T_start) before finishing" }, { status: 400 });
    }

    if (newStatus !== assignment.status && ["t_in", "t_start", "t_out"].includes(eventType)) {
      await supabase
        .from("assignments")
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq("id", assignment.id);

      // Sync orders.status when service completes
      if (eventType === "t_out") {
        await supabase
          .from("orders")
          .update({ status: "completed", updated_at: new Date().toISOString() })
          .eq("id", orderId);
      }
    }

    // Insertar log del evento
    const vancouverTimestamp = new Date().toLocaleString("en-CA", { timeZone: "America/Vancouver", hour12: false }).replace(", ", "T");
    const { data: log, error: logError } = await supabase
      .from("service_logs")
      .insert({
        order_id: orderId,
        employee_id: employee.id,
        event_type: eventType,
        timestamp: vancouverTimestamp,
        location_lat: locationLat ?? null,
        location_lng: locationLng ?? null,
        photo_url: photoUrl ?? null,
        notes: notes ?? null,
      })
      .select()
      .single();

    if (logError) {
      console.error("Service log error:", logError);
      return NextResponse.json({ error: logError.message }, { status: 500 });
    }

    return NextResponse.json(
      { success: true, eventType, logId: log.id, assignmentStatus: newStatus, timestamp: log.timestamp },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Service event error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

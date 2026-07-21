import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { haversineDistance, MEETING_POINT_RADIUS_METERS } from "@/lib/geocode";

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

// POST /api/empleado/jornada — iniciar o cerrar jornada
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, locationLat, locationLng } = body;

    if (!action || !["start", "end"].includes(action)) {
      return NextResponse.json({ error: "Invalid action. Use 'start' or 'end'" }, { status: 400 });
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

    const eventType = action === "start" ? "jornada_start" : "jornada_end";

    // v8.3 auditoría 2026-07-21 (D-P1-1): la jornada no tenía máquina de
    // estados -- nada comprobaba el último evento antes de insertar uno
    // nuevo, permitiendo doble 'start' sin 'end' previo, 'end' sin
    // 'start' abierto, o jornadas abiertas indefinidamente. Se consulta
    // el último evento de jornada (order_id IS NULL) de este empleado y
    // se rechaza la transición inválida.
    const { data: lastJornadaEvent, error: lastEventError } = await supabase
      .from("service_logs")
      .select("event_type, timestamp")
      .eq("employee_id", employee.id)
      .is("order_id", null)
      .in("event_type", ["jornada_start", "jornada_end"])
      .order("timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastEventError) {
      return NextResponse.json({ error: lastEventError.message }, { status: 500 });
    }

    const lastEventType = lastJornadaEvent?.event_type ?? null;

    if (action === "start" && lastEventType === "jornada_start") {
      return NextResponse.json(
        { error: "Ya hay una jornada abierta. Debes cerrarla (end) antes de iniciar otra." },
        { status: 409 }
      );
    }
    if (action === "end" && lastEventType !== "jornada_start") {
      return NextResponse.json(
        { error: "No hay una jornada abierta para cerrar. Debes iniciar (start) primero." },
        { status: 409 }
      );
    }

    // v8.3 E4 fix (auditoría 2026-07-18) — inicio de jornada guardaba
    // lat/lng sin comparar contra ninguna referencia: un empleado podía
    // "iniciar jornada" desde cualquier lugar del mundo sin que quedara
    // registro de la desviación. La única coordenada de referencia real
    // que existe hoy en el sistema para "punto de encuentro" es el
    // domicilio geocodificado del primer servicio agendado del empleado
    // para el día (orders.address_lat/lng vía quotes, mismo patrón que
    // /api/empleado/jornada/precarga). No bloquea el inicio (un GPS
    // ausente o impreciso no debe impedir trabajar) — solo flaggea con
    // distancia real para que un supervisor lo revise.
    let outsideMeetingPoint = false;
    let meetingPointDistanceM: number | null = null;

    if (action === "start" && typeof locationLat === "number" && typeof locationLng === "number") {
      try {
        const vancouverDateOnly = new Date().toLocaleString("en-CA", {
          timeZone: "America/Vancouver",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        });
        const today = vancouverDateOnly.split(",")[0];

        const { data: todaysAssignments } = await supabase
          .from("assignments")
          .select("order_id, orders:order_id ( service_time, address_lat, address_lng, service_date )")
          .is("deleted_at", null)
          .eq("employee_id", employee.id);

        type OrderRef = { service_time: string | null; address_lat: number | null; address_lng: number | null; service_date: string | null };
        const todaysWithCoords = (todaysAssignments || [])
          .map((a) => a.orders as unknown as OrderRef | null)
          .filter((o): o is OrderRef => !!o && o.service_date === today && o.address_lat != null && o.address_lng != null)
          .sort((a, b) => (a.service_time || "").localeCompare(b.service_time || ""));

        const meetingPointRef = todaysWithCoords[0];
        if (meetingPointRef && meetingPointRef.address_lat != null && meetingPointRef.address_lng != null) {
          const distance = haversineDistance(
            { lat: locationLat, lng: locationLng },
            { lat: meetingPointRef.address_lat, lng: meetingPointRef.address_lng }
          );
          meetingPointDistanceM = distance;
          outsideMeetingPoint = distance > MEETING_POINT_RADIUS_METERS;
        }
      } catch (e) {
        console.error("Meeting point GPS check error (degrading to unflagged):", e);
      }
    }

    // Insertar log de jornada con timestamp ISO explícito en Vancouver
    const now = new Date();
    const vancouverOffset = now.toLocaleString("en-CA", { timeZone: "America/Vancouver", timeZoneName: "short" }).includes("PDT") ? "-07:00" : "-08:00";
    const vancouverTimestamp = now.toLocaleString("en-CA", { timeZone: "America/Vancouver", hour12: false }).replace(", ", "T") + vancouverOffset;
    const { data: log, error: logError } = await supabase
      .from("service_logs")
      .insert({
        order_id: null, // jornada no está ligada a un order específico
        employee_id: employee.id,
        event_type: eventType,
        timestamp: vancouverTimestamp,
        location_lat: locationLat ?? null,
        location_lng: locationLng ?? null,
        outside_meeting_point: outsideMeetingPoint,
        meeting_point_distance_m: meetingPointDistanceM,
      })
      .select()
      .single();

    if (logError) {
      console.error("Jornada log error:", logError);
      return NextResponse.json({ error: logError.message }, { status: 500 });
    }

    return NextResponse.json(
      {
        success: true,
        eventType,
        logId: log.id,
        timestamp: log.timestamp,
        outsideMeetingPoint,
        meetingPointDistanceM,
      },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Jornada error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

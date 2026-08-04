import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { haversineDistance, MEETING_POINT_RADIUS_METERS } from "@/lib/geocode";
import { requireActiveEmployee } from "@/lib/require-active-employee";
import { getVancouverTodayString, getVancouverOffset } from "@/lib/date-utils";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase-server";
import { safeErrorResponse } from "@/lib/api-errors";

function getSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(
    getSupabaseUrl(),
    getSupabaseAnonKey(),
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          cookieStore.set({ name, value, ...options, httpOnly: true, secure: true, sameSite: "lax" });
        },
        remove(name: string, options: CookieOptions) {
          cookieStore.set({ name, value: "", ...options, httpOnly: true, secure: true, sameSite: "lax" });
        },
      },
    }
  );
}

// POST /api/employee/shift — iniciar o cerrar jornada
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
    const { employee, error: empError, status: empStatus } = await requireActiveEmployee(supabase, user.id);

    if (!employee) {
      return NextResponse.json({ error: empError }, { status: empStatus });
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
      console.error("lastEventError:", lastEventError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
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
    // /api/employee/shift/preload). No bloquea el inicio (un GPS
    // ausente o impreciso no debe impedir trabajar) — solo flaggea con
    // distancia real para que un supervisor lo revise.
    let outsideMeetingPoint = false;
    let meetingPointDistanceM: number | null = null;

    if (action === "start" && typeof locationLat === "number" && typeof locationLng === "number") {
      try {
        const today = getVancouverTodayString();

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

    // Insertar log de jornada con timestamp ISO explícito en Vancouver.
    // v8.3 ROUND 4 fix (#2): antes parseaba "PDT"/"PST" de toLocaleString(), que puede
    // devolver "GMT-7" en vez de la abreviatura según navegador/runtime. Usamos el offset
    // numérico real vía Intl (getVancouverOffset), robusto en cualquier entorno.
    const now = new Date();
    const vancouverLocal = now.toLocaleString("en-CA", { timeZone: "America/Vancouver", hour12: false });
    const vancouverDateOnly = vancouverLocal.split(",")[0];
    const vancouverOffset = getVancouverOffset(vancouverDateOnly);
    const vancouverTimestamp = vancouverLocal.replace(", ", "T") + vancouverOffset;
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
      console.error("logError:", logError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
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
    return safeErrorResponse(err);
  }
}

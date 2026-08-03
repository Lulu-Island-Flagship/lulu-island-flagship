import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ORDER_CLIENT_COLUMNS } from "@/lib/client-visible-columns";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase-server";
import { isValidUuid } from "@/lib/validation";
import { requireClientCaller } from "@/lib/require-client-caller";

function getSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
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
  });
}

// Ventana en la que el cliente puede ver el tracking del vehículo, antes de
// la hora agendada del servicio.
const TRACKING_VISIBLE_MINUTES_BEFORE = 30;

/**
 * GET /api/client/orders/[orderId]/vehicle-tracking
 *
 * v8.3 E3 fix — Tracking de vehículo cliente-facing. Antes `vehicle_tracking`
 * y `vehicles.current_lat/current_lng` solo se escribían desde
 * /api/empleado/vehicle-tracking y solo se leían por supervisores (RLS de
 * 026_modulo3_capacity_dispatch.sql) -- el cliente nunca podía ver dónde
 * estaba el equipo yendo a su casa.
 *
 * Invariante B.2.17 (ya usada en la galería, api/client/orders/[orderId]/gallery):
 * GPS del VEHÍCULO, no de la PERSONA. `vehicle_tracking` se diseñó así desde
 * el inicio (comentario en la migración: "tracking por vehículo, no por
 * persona") -- esta ruta solo agrega lat/lng, nunca employee_id ni nombre.
 *
 * Visibilidad: solo dentro de los 30 minutos previos a `service_datetime`
 * (y mientras la orden siga "confirmed", antes de completarse). Fuera de esa
 * ventana se responde con `emptyReason` explícito en vez de datos parciales.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const supabase = getSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientGuard = await requireClientCaller(supabase, user.id);
  if (!clientGuard.ok) {
    return NextResponse.json({ error: clientGuard.error }, { status: clientGuard.status });
  }

  const { orderId } = await params;

  if (!isValidUuid(orderId)) {
    return NextResponse.json({ error: "orderId inválido" }, { status: 400 });
  }

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select(ORDER_CLIENT_COLUMNS)
    .eq("id", orderId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (orderError) {
    console.error("orderError:", orderError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }
  if (!order) return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });

  if (order.status !== "confirmed") {
    return NextResponse.json(
      {
        emptyReason: "not_trackable",
        message:
          order.status === "completed"
            ? "Este servicio ya se completó."
            : "El tracking en vivo solo está disponible para servicios confirmados.",
      },
      { status: 200 }
    );
  }

  const serviceDateTime = new Date(order.service_datetime as string);
  const windowStart = new Date(serviceDateTime.getTime() - TRACKING_VISIBLE_MINUTES_BEFORE * 60 * 1000);
  const now = new Date();

  if (now < windowStart) {
    return NextResponse.json(
      {
        emptyReason: "too_early",
        message: `El tracking en vivo estará disponible ${TRACKING_VISIBLE_MINUTES_BEFORE} minutos antes de su servicio.`,
        visibleFrom: windowStart.toISOString(),
      },
      { status: 200 }
    );
  }

  // Servicio ya debió terminar hace rato y sigue "confirmed" (no se marcó
  // completed) -- no seguimos mostrando un vehículo "en camino" indefinidamente.
  const windowEnd = new Date(serviceDateTime.getTime() + 4 * 60 * 60 * 1000);
  if (now > windowEnd) {
    return NextResponse.json(
      {
        emptyReason: "expired",
        message: "La ventana de tracking en vivo para este servicio ya terminó.",
      },
      { status: 200 }
    );
  }

  const { data: assignment, error: assignmentError } = await supabase
    .from("assignments")
    .select("employee_id, status")
    .eq("order_id", orderId)
    .in("status", ["pending", "en_route", "arrived", "in_progress"])
    .limit(1)
    .maybeSingle();
  if (assignmentError) {
    console.error("assignmentError:", assignmentError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }
  if (!assignment?.employee_id) {
    return NextResponse.json(
      {
        emptyReason: "no_assignment",
        message: "Aún no hay un equipo asignado a este servicio.",
      },
      { status: 200 }
    );
  }

  const { data: employee, error: employeeError } = await supabase
    .from("employees")
    .select("vehicle_id")
    .eq("id", assignment.employee_id)
    .maybeSingle();
  if (employeeError) {
    console.error("employeeError:", employeeError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }
  if (!employee?.vehicle_id) {
    return NextResponse.json(
      {
        emptyReason: "no_vehicle",
        message: "El equipo asignado aún no reportó un vehículo con GPS.",
      },
      { status: 200 }
    );
  }

  // Nunca se selecciona employee_id/nombre -- solo la ubicación del vehículo.
  const { data: vehicle, error: vehicleError } = await supabase
    .from("vehicles")
    .select("current_lat, current_lng, last_location_at")
    .eq("id", employee.vehicle_id)
    .maybeSingle();
  if (vehicleError) {
    console.error("vehicleError:", vehicleError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }
  if (!vehicle?.current_lat || !vehicle?.current_lng) {
    return NextResponse.json(
      {
        emptyReason: "no_location_yet",
        message: "Aún no tenemos una ubicación reciente del vehículo.",
      },
      { status: 200 }
    );
  }

  return NextResponse.json(
    {
      lat: vehicle.current_lat,
      lng: vehicle.current_lng,
      lastUpdatedAt: vehicle.last_location_at,
    },
    { status: 200 }
  );
}

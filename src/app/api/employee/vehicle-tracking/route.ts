import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { requireActiveEmployee } from "@/lib/require-active-employee";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase-server";
import { safeErrorResponse } from "@/lib/api-errors";

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

// POST /api/employee/vehicle-tracking — registrar ubicación del vehículo asignado
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { lat, lng, source = "driver_app" } = body;

    if (lat === undefined || lng === undefined || typeof lat !== "number" || typeof lng !== "number") {
      return NextResponse.json({ error: "lat and lng are required" }, { status: 400 });
    }

    // Fix (auditoría externa, hallazgo confirmado): antes solo se validaba
    // el TIPO (number) de lat/lng, no el RANGO -- un GPS con lectura
    // corrupta, un bug de cliente, o un payload manipulado directamente
    // contra este endpoint podía insertar coordenadas imposibles (ej. lat
    // 200) en vehicle_tracking/vehicles, corrompiendo silenciosamente la
    // posición mostrada a dispatch. Mismo criterio de validación explícita
    // ya usado en el resto del repo para datos geográficos entrantes.
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      return NextResponse.json(
        { error: "lat must be between -90 and 90, lng must be between -180 and 180" },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { employee, error: empError, status: empStatus } = await requireActiveEmployee<{
      id: string;
      vehicle_id: string | null;
    }>(supabase, user.id, "id, vehicle_id");

    if (!employee) {
      return NextResponse.json({ error: empError }, { status: empStatus });
    }

    if (!employee.vehicle_id) {
      return NextResponse.json({ error: "No vehicle assigned to this employee" }, { status: 400 });
    }

    const recordedAt = new Date().toISOString();

    const { error: trackingError } = await supabase.from("vehicle_tracking").insert({
      vehicle_id: employee.vehicle_id,
      lat,
      lng,
      source,
      recorded_at: recordedAt,
    });

    if (trackingError) {
      console.error("Vehicle tracking insert error:", trackingError);
      console.error("trackingError:", trackingError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    // Actualizar ubicación actual del vehículo
    await supabase
      .from("vehicles")
      .update({
        current_lat: lat,
        current_lng: lng,
        last_location_at: recordedAt,
        updated_at: recordedAt,
      })
      .eq("id", employee.vehicle_id);

    return NextResponse.json({ success: true, vehicleId: employee.vehicle_id, recordedAt }, { status: 200 });
  } catch (err: Error | unknown) {
    return safeErrorResponse(err);
  }
}

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder";

function getSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(supabaseUrl, supabaseKey, {
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
  });
}

// POST /api/empleado/vehicle-tracking — registrar ubicación del vehículo asignado
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { lat, lng, source = "driver_app" } = body;

    if (lat === undefined || lng === undefined || typeof lat !== "number" || typeof lng !== "number") {
      return NextResponse.json({ error: "lat and lng are required" }, { status: 400 });
    }

    const supabase = getSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: employee, error: empError } = await supabase
      .from("employees")
      .select("id, vehicle_id")
      .eq("user_id", user.id)
      .single();

    if (empError || !employee) {
      return NextResponse.json({ error: "Employee profile not found" }, { status: 403 });
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
      return NextResponse.json({ error: trackingError.message }, { status: 500 });
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
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Vehicle tracking error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

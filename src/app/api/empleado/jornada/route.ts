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

    // Insertar log de jornada
    const { data: log, error: logError } = await supabase
      .from("service_logs")
      .insert({
        order_id: null, // jornada no está ligada a un order específico
        employee_id: employee.id,
        event_type: eventType,
        timestamp: new Date().toISOString(),
        location_lat: locationLat ?? null,
        location_lng: locationLng ?? null,
      })
      .select()
      .single();

    if (logError) {
      console.error("Jornada log error:", logError);
      return NextResponse.json({ error: logError.message }, { status: 500 });
    }

    return NextResponse.json(
      { success: true, eventType, logId: log.id, timestamp: log.timestamp },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Jornada error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { requireActiveEmployee } from "@/lib/require-active-employee";

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

// PATCH /api/empleado/safety-abort/[id] — actualizar GPS vivo mientras el SOS
// sigue activo. v8.3 E7 (D.10 #7): "SOS con GPS vivo".
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await request.json();
    const { gpsLat, gpsLng } = body;

    if (typeof gpsLat !== "number" || typeof gpsLng !== "number") {
      return NextResponse.json({ error: "gpsLat and gpsLng (numbers) are required" }, { status: 400 });
    }

    const supabase = getSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { employee, error: empError, status: empStatus } = await requireActiveEmployee(supabase, user.id);

    if (!employee) {
      return NextResponse.json({ error: empError }, { status: empStatus });
    }

    // Fix Kimi-M5 (auditoría externa Kimi Code, 2026-07-21, verificado y
    // confirmado real): este PATCH no verificaba que el SOS pertenezca al
    // empleado que llama -- a diferencia de M6 (duplicados/orden ajena en
    // el POST, que se deja intencionalmente sin bloquear por ser seguridad
    // P0), este SÍ es un riesgo real distinto: sin este chequeo, cualquier
    // empleado autenticado podía inyectar coordenadas GPS falsas en el SOS
    // ACTIVO de OTRO empleado, potencialmente desviando una respuesta de
    // emergencia real. Se restringe a `.eq("reported_by", employee.id)`.
    const { data, error } = await supabase
      .from("safety_aborts")
      .update({
        gps_lat: gpsLat,
        gps_lng: gpsLng,
        gps_updated_at: new Date().toISOString(),
      })
      .eq("id", params.id)
      .eq("reported_by", employee.id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ safetyAbort: data }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { requireActiveEmployee } from "@/lib/require-active-employee";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase-server";
import { safeErrorResponse } from "@/lib/api-errors";
import { isValidUuid } from "@/lib/validation";

function getSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        cookieStore.set({ name, value, ...options, secure: true, sameSite: "lax" });
      },
      remove(name: string, options: CookieOptions) {
        cookieStore.set({ name, value: "", ...options, secure: true, sameSite: "lax" });
      },
    },
  });
}

// PATCH /api/employee/safety-abort/[id] — actualizar GPS vivo mientras el SOS
// sigue activo. v8.3 E7 (D.10 #7): "SOS con GPS vivo".
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!isValidUuid(params.id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

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
      console.error("Supabase query error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json({ safetyAbort: data }, { status: 200 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

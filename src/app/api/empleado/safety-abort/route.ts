import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { isDoubleConfirmed } from "@/lib/safety-abort";
import { publishUnifiedAlert } from "@/lib/unified-alerts";

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

// POST /api/empleado/safety-abort — iniciar aborto seguro.
// v8.3 E7 (D.10 #7): P0 seguridad humana. NUNCA se bloquea por RBAC
// administrativo — cualquier empleado autenticado puede activar un SOS.
// Requiere doble confirmación explícita (firstConfirmed + secondConfirmed)
// antes de aceptar el SOS como activo.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { orderId, reason, firstConfirmed, secondConfirmed, gpsLat, gpsLng } = body;

    const nowIso = new Date().toISOString();
    const firstConfirmedAt = firstConfirmed ? nowIso : null;
    const secondConfirmedAt = secondConfirmed ? nowIso : null;

    if (!isDoubleConfirmed(firstConfirmedAt, secondConfirmedAt)) {
      return NextResponse.json(
        { error: "Se requiere doble confirmación (firstConfirmed y secondConfirmed) antes de activar el SOS." },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: employee } = await supabase
      .from("employees")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!employee) {
      return NextResponse.json({ error: "Employee profile not found" }, { status: 403 });
    }

    const { data, error } = await supabase
      .from("safety_aborts")
      .insert({
        order_id: orderId || null,
        reported_by: employee.id,
        reason: reason || null,
        first_confirmed_at: firstConfirmedAt,
        second_confirmed_at: secondConfirmedAt,
        sos_started_at: nowIso,
        gps_lat: typeof gpsLat === "number" ? gpsLat : null,
        gps_lng: typeof gpsLng === "number" ? gpsLng : null,
        gps_updated_at: typeof gpsLat === "number" && typeof gpsLng === "number" ? nowIso : null,
        stage: "sos_active",
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // v8.3 E0.6: publica en la bandeja unificada. P0 seguridad humana — nunca
    // se bloquea el SOS si esto falla, es una alerta secundaria a la acción
    // principal ya guardada arriba.
    await publishUnifiedAlert(supabase, {
      sourceModule: "safety_abort",
      sourceTable: "safety_aborts",
      sourceId: data.id as string,
      tier: "respond_10min",
      severity: "p0_safety",
      title: "Aborto seguro activado (SOS)",
      summary: reason ? String(reason) : "Sin razón especificada por el empleado.",
    });

    return NextResponse.json({ safetyAbort: data }, { status: 201 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

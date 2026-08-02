import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { isDoubleConfirmed } from "@/lib/safety-abort";
import { publishUnifiedAlert } from "@/lib/unified-alerts";
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

    const { employee, error: empError, status: empStatus } = await requireActiveEmployee(supabase, user.id);

    if (!employee) {
      return NextResponse.json({ error: empError }, { status: empStatus });
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
      console.error("Supabase query error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
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
        return safeErrorResponse(err);
  }
}

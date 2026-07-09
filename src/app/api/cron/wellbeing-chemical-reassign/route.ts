import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { isChemicalAlertTimerExpired } from "@/lib/wellbeing";

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

// GET /api/cron/wellbeing-chemical-reassign — v8.3 E8 regla dura: timer de
// 10 min sin respuesta admin => marca la alerta como auto_reassigned.
//
// LIMITACION HONESTA: este cron detecta el vencimiento del timer y marca la
// alerta, pero NO ejecuta todavia la reasignacion real del empleado a una
// tarea de bajo riesgo (eso requiere integrarse con buildTeam()/dispatch-
// scheduler y una nocion de "nivel de riesgo por tarea" que hoy no existe
// en el esquema de assignments). Se deja marcado explicitamente en el
// registro (auto_reassigned_at) para que un admin actue manualmente hasta
// que se construya esa integracion.
export async function GET(request: NextRequest) {
  const cronSecret = request.headers.get("authorization")?.replace("Bearer ", "");
  if (cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = getSupabaseClient();
    const now = new Date().toISOString();

    const { data: pending, error } = await supabase
      .from("wellbeing_chemical_alerts")
      .select("id, reported_at, admin_responded_at")
      .or("resolution.eq.pending,resolution.is.null");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const expired = (pending || []).filter((a) =>
      isChemicalAlertTimerExpired(a.reported_at, now, a.admin_responded_at)
    );

    for (const alert of expired) {
      await supabase
        .from("wellbeing_chemical_alerts")
        .update({ resolution: "auto_reassigned", auto_reassigned_at: now })
        .eq("id", alert.id);
    }

    return NextResponse.json({ processed: expired.length, checked: (pending || []).length }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

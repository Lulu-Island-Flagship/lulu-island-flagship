import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { evaluateSafetyAbortEscalation } from "@/lib/safety-abort";

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

// GET /api/cron/safety-abort-escalation — recalcula y persiste la etapa de
// todo SOS activo (no reconocido, no auto-aprobado todavía). Debe correr con
// frecuencia corta (ej. cada minuto) dado que la ventana más corta es 2 min.
//
// v8.3 E7 (D.10 #7): esta ruta SOLO recalcula/persiste el estado (stage,
// auto_approved). El envío real de SMS/llamada al admin ("llamada auto a
// admin (2 min)", "Admin de Emergencia (4 min)") requiere el adaptador de
// Twilio (C.1/C.2) que todavía no existe en el repo — no se inventa aquí.
// Cuando ese adaptador exista, este cron es el punto exacto donde debe
// dispararse la notificación al cruzar cada umbral.
export async function GET(request: NextRequest) {
  const cronSecret = request.headers.get("authorization")?.replace("Bearer ", "");
  if (cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseClient();

  try {
    const { data: activeAborts, error } = await supabase
      .from("safety_aborts")
      .select("id, sos_started_at, acknowledged_at, stage, auto_approved")
      .is("deleted_at", null)
      .is("acknowledged_at", null)
      .neq("stage", "auto_approved")
      .not("sos_started_at", "is", null);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const nowIso = new Date().toISOString();
    let updated = 0;
    const transitions: { id: string; from: string; to: string }[] = [];

    for (const row of activeAborts || []) {
      const result = evaluateSafetyAbortEscalation(row.sos_started_at as string, nowIso, null);
      if (result.stage !== row.stage) {
        const { error: updateError } = await supabase
          .from("safety_aborts")
          .update({ stage: result.stage, auto_approved: result.autoApproved })
          .eq("id", row.id);
        if (!updateError) {
          updated += 1;
          transitions.push({ id: row.id, from: row.stage, to: result.stage });
        }
      }
    }

    return NextResponse.json(
      { checked: activeAborts?.length || 0, updated, transitions },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

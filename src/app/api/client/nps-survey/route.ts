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

// Fix (auditoría 2026-07-31, hallazgo #17): nps_surveys nunca expiraba --
// no había columna `expires_at` ni ninguna validación de vigencia, así que
// una encuesta enviada hace meses o años seguía siendo respondible
// indefinidamente vía su `token` (UUID) sin ningún límite temporal. En vez
// de agregar una columna nueva (que requeriría backfill sobre filas ya
// existentes desde la migración 163 -- esta tabla es de v8.3 E10.13,
// anterior al Módulo de Cliente de hoy, así que probablemente SÍ tiene
// datos reales de producción; no se pudo verificar el conteo real de filas
// desde este entorno, sin acceso a la base de datos en vivo), se reutiliza
// la columna `sent_at` que YA existe y YA es NOT NULL para toda fila
// (nueva o histórica) -- cero riesgo de backfill. Se define una ventana
// razonable de 30 días desde el envío para responder (una encuesta
// trimestral respondible casi un mes después sigue siendo útil sin ser
// indefinida).
const NPS_SURVEY_RESPONSE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * POST /api/client/nps-survey — { token, score, comment? }
 *
 * v8.3 E10.13 — Respuesta a la encuesta NPS trimestral. Sin incentivo
 * económico (a diferencia de pre-review-survey) — mezclar recompensa con
 * NPS sesgaría el puntaje.
 */
export async function POST(request: NextRequest) {
  const supabase = getSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { token?: string; score?: number; comment?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (!body.token || typeof body.score !== "number" || body.score < 0 || body.score > 10) {
    return NextResponse.json({ error: "token y score (0-10) son obligatorios" }, { status: 400 });
  }

  const { data: survey, error: fetchError } = await supabase
    .from("nps_surveys")
    .select("id, client_user_id, responded_at, sent_at")
    .eq("token", body.token)
    .is("deleted_at", null)
    .maybeSingle();
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
  if (!survey || survey.client_user_id !== user.id) {
    return NextResponse.json({ error: "Encuesta no encontrada" }, { status: 404 });
  }
  if (survey.responded_at) {
    return NextResponse.json({ error: "Ya se respondió esta encuesta" }, { status: 409 });
  }
  if (Date.now() - new Date(survey.sent_at).getTime() > NPS_SURVEY_RESPONSE_WINDOW_MS) {
    return NextResponse.json({ error: "Esta encuesta ya expiró" }, { status: 410 });
  }

  const { error: updateError } = await supabase
    .from("nps_surveys")
    .update({ score: body.score, comment: body.comment?.trim() || null, responded_at: new Date().toISOString() })
    .eq("id", survey.id);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  return NextResponse.json({ ok: true }, { status: 200 });
}

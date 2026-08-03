import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase-server";
import { requireClientCaller } from "@/lib/require-client-caller";

// v8.3 fix (auditoría seguridad 2026-07-26): el regex original
// (/^\d{4}-\d{2}-\d{2}$/) solo valida el FORMATO -- "2023-99-99" pasaba
// intacto. Se valida además que mes/día formen una fecha calendario real
// (incluye años bisiestos vía Date.UTC, que normaliza "2023-02-30" a marzo
// en vez de aceptarlo) y que no sea una fecha futura (bug P3 de UX ya
// reportado: "Cumpleaños acepta fechas futuras").
function isValidPastBirthDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;

  const asUtcDate = new Date(Date.UTC(year, month - 1, day));
  // Date normaliza días fuera de rango (ej. 2023-02-30 -> 2023-03-02) --
  // si el round-trip no coincide, la fecha calendario no existía de verdad
  // (esto también cubre 29 de febrero en años no bisiestos).
  if (
    asUtcDate.getUTCFullYear() !== year ||
    asUtcDate.getUTCMonth() !== month - 1 ||
    asUtcDate.getUTCDate() !== day
  ) {
    return false;
  }

  const todayUtc = new Date();
  const todayUtcMidnight = Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), todayUtc.getUTCDate());
  if (asUtcDate.getTime() > todayUtcMidnight) return false;

  return true;
}

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

/**
 * GET  /api/client/communication-preferences — estado actual de opt-in de
 *      marketing de la cuenta autenticada (v8.3 E6.5).
 * POST /api/client/communication-preferences — { marketingOptIn: boolean }
 *      Cambia el estado. Un opt-IN aquí es la reafirmación explícita que
 *      CASL exige después de una baja (nunca se reactiva solo, ni por un
 *      admin, ni automáticamente).
 */
export async function GET() {
  const supabase = getSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientGuard = await requireClientCaller(supabase, user.id);
  if (!clientGuard.ok) {
    return NextResponse.json({ error: clientGuard.error }, { status: clientGuard.status });
  }

  // Fix (auditoría de integridad de datos 2026-08-01): un GET no debe tener
  // side effects (viola la semántica HTTP) -- la versión anterior hacía un
  // upsert() que INSERTABA una fila en client_profiles como efecto
  // secundario de una simple lectura. Un cliente recién registrado (sin
  // client_profiles todavía, porque esa tabla solo se crea hoy en su primera
  // cotización/orden) simplemente no tiene preferencias guardadas todavía --
  // se devuelven los defaults de la migración 001 sin escribir nada. La
  // creación real del perfil sigue viviendo en el flujo de POST/quote
  // correspondiente (getOrCreateClientProfile()); si el cliente cambia una
  // preferencia, el POST de abajo (que sí es una escritura legítima) crea
  // la fila si hace falta.
  const { data, error } = await supabase
    .from("client_profiles")
     .select("marketing_opt_in, marketing_opt_in_updated_at, auto_unsubscribed_at, birth_date, wechat_notifications")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("Supabase query error:", error);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json(
      { marketingOptIn: false, updatedAt: null, autoUnsubscribedAt: null, birthDate: null, wechatNotifications: false },
      { status: 200 }
    );
  }

  return NextResponse.json(
    {
      marketingOptIn: data.marketing_opt_in,
      updatedAt: data.marketing_opt_in_updated_at,
      autoUnsubscribedAt: data.auto_unsubscribed_at,
      // v8.3 E5.12: opcional, solo para el regalo de cumpleaños configurable.
      birthDate: data.birth_date,
      wechatNotifications: (data as { wechat_notifications?: boolean }).wechat_notifications ?? false,
    },
    { status: 200 }
  );
}

export async function POST(request: NextRequest) {
  const supabase = getSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientGuard = await requireClientCaller(supabase, user.id);
  if (!clientGuard.ok) {
    return NextResponse.json({ error: clientGuard.error }, { status: clientGuard.status });
  }

  let body: { marketingOptIn?: unknown; birthDate?: unknown; wechatNotifications?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};

  if (body.marketingOptIn !== undefined) {
    if (typeof body.marketingOptIn !== "boolean") {
      return NextResponse.json({ error: "marketingOptIn debe ser boolean" }, { status: 400 });
    }
    update.marketing_opt_in = body.marketingOptIn;
    update.marketing_opt_in_updated_at = new Date().toISOString();
    // Reafirmar opt-in manualmente limpia la marca de baja-por-re-engagement
    // -- esa marca es informativa (por qué se dio de baja), no un candado.
    if (body.marketingOptIn) {
      update.auto_unsubscribed_at = null;
    }
  }

  // v8.3 E5.12: birth_date es SIEMPRE opcional (PIPA: nunca obligatorio) y
  // solo alimenta el regalo de cumpleaños configurable -- nunca se usa para
  // scoring, riesgo ni ninguna otra decisión.
  if (body.birthDate !== undefined) {
    if (body.birthDate !== null && !isValidPastBirthDate(String(body.birthDate))) {
      return NextResponse.json(
        { error: "birthDate debe ser una fecha YYYY-MM-DD válida y no futura, o null" },
        { status: 400 }
      );
    }
    update.birth_date = body.birthDate;
  }

  if (body.wechatNotifications !== undefined) {
    if (typeof body.wechatNotifications !== "boolean") {
      return NextResponse.json({ error: "wechatNotifications debe ser boolean" }, { status: 400 });
    }
    update.wechat_notifications = body.wechatNotifications;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  // Mismo problema que GET arriba: .update().eq(...) sobre una fila que
  // todavía no existe (cliente nuevo, sin client_profiles) actualiza 0
  // filas y el .single() posterior revienta con el mismo error crudo de
  // PostgREST. upsert() con user_id incluido crea la fila si falta (mismos
  // defaults de la migración 001) y la actualiza si ya existía, en una sola
  // llamada.
  const { data, error } = await supabase
    .from("client_profiles")
    .upsert({ user_id: user.id, ...update }, { onConflict: "user_id" })
    .select("marketing_opt_in, marketing_opt_in_updated_at, birth_date, wechat_notifications")
    .single();

  if (error) {
    console.error("Supabase query error:", error);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  return NextResponse.json(
    {
      marketingOptIn: data.marketing_opt_in,
      updatedAt: data.marketing_opt_in_updated_at,
      birthDate: data.birth_date,
      wechatNotifications: (data as { wechat_notifications?: boolean }).wechat_notifications ?? false,
    },
    { status: 200 }
  );
}

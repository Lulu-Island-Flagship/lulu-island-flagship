import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { locales, defaultLocale } from "@/i18n/config";

// Fix (auditoría 2026-07-31, hallazgo confirmado): mismo criterio que
// src/lib/admin.ts y src/app/auth/callback/route.ts -- el throw vive dentro
// de funciones evaluadas en tiempo de ejecución (nunca a nivel de módulo)
// para no arriesgar el build estático si faltan las env vars solo en el
// entorno de build.
function getSupabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL no está configurado");
  }
  return url;
}

function getSupabaseAnonKey(): string {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY no está configurado");
  }
  return key;
}

// v8.3 fix M-8 (auditoría implacable 2026-07-20b): antes siempre
// redirigía a "/" a secas -- un usuario en /fr/admin/... terminaba en /en
// (locale por defecto del middleware) tras cerrar sesión, perdiendo su
// idioma. Esta Route Handler no conoce el locale del request salvo que
// alguien se lo pase explícitamente: se lee primero de ?locale= (el
// trigger de logout en admin/layout.tsx ahora lo manda, ver
// src/app/[locale]/admin/layout.tsx) y, si falta o no es válido, se
// intenta derivar del primer segmento del Referer -- solo como fallback,
// nunca como fuente primaria, porque el Referer puede faltar (algunos
// navegadores/extensiones lo bloquean) o venir de otro origen.
function resolveSignoutLocale(request: NextRequest): string {
  const queryLocale = request.nextUrl.searchParams.get("locale");
  if (queryLocale && (locales as readonly string[]).includes(queryLocale)) {
    return queryLocale;
  }

  const referer = request.headers.get("referer");
  if (referer) {
    try {
      const refererPath = new URL(referer).pathname;
      const candidate = refererPath.split("/")[1];
      if (candidate && (locales as readonly string[]).includes(candidate)) {
        return candidate;
      }
    } catch {
      // Referer inválido/no parseable -- se ignora, cae al default.
    }
  }

  return defaultLocale;
}

export async function POST(request: NextRequest) {
  const locale = resolveSignoutLocale(request);

  // Fix (auditoría 2026-07-31, hallazgo confirmado): antes ni la
  // construcción del cliente ni supabase.auth.signOut() tenían try/catch --
  // si Supabase Auth estaba caído o faltaba config, este handler tiraba una
  // excepción sin manejar y Next.js respondía con un 500 genérico, dejando
  // al usuario sin poder cerrar sesión ni volver a ningún lado conocido. El
  // signOut del lado servidor solo revoca el refresh token / limpia
  // cookies; si falla, igual queremos mandar al usuario de vuelta al home
  // (mismo destino que el caso exitoso) en vez de mostrarle una pantalla de
  // error por un problema que no puede resolver desde ahí.
  try {
    const cookieStore = cookies();
    const supabase = createServerClient(
      getSupabaseUrl(),
      getSupabaseAnonKey(),
      {
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
      }
    );

    await supabase.auth.signOut();
  } catch (err) {
    console.error("auth/signout: signOut failed, redirecting home anyway", err);
  }

  // Fix (auditoría en vivo 2026-08-01, prueba E2E como cliente real): esto
  // usaba `process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"` como
  // base -- NEXT_PUBLIC_APP_URL nunca se configuró en Vercel (confirmado:
  // no existe entre las variables de entorno del proyecto), así que en
  // producción el redirect SIEMPRE apuntaba a "http://localhost:3000/...",
  // un origen distinto al real. El fetch con `redirect: "follow"` que hace
  // CuentaNav.tsx (handleSignout) no puede seguir un redirect a un origen
  // inalcanzable/cross-origin desde el navegador del cliente real, así que
  // fallaba silenciosamente y mostraba "Couldn't log out" -- aunque
  // supabase.auth.signOut() (arriba) ya había limpiado las cookies de sesión
  // correctamente antes de intentar el redirect. Se usa `request.url` como
  // base, mismo patrón ya establecido en src/app/auth/callback/route.ts: la
  // URL real que el navegador usó para llegar aquí siempre es el origen
  // correcto, sin depender de ninguna env var adicional.
  //
  // Fix (auditoría en vivo 2026-08-01, verificación en producción tras el fix
  // anterior): con el origen ya corregido, el fetch de CuentaNav.tsx SÍ lograba
  // seguir el redirect -- pero NextResponse.redirect() sin status explícito usa
  // 307 (Temporary Redirect), que por spec de HTTP preserva el método original
  // de la petición. Como el POST original venía de un <form>/fetch POST a
  // /auth/signout, el navegador reintentaba el destino final (`/${locale}`)
  // también con POST -- y esa página solo tiene handler GET, así que Next.js
  // respondía 405 Method Not Allowed. Confirmado en los logs de Vercel: POST
  // /auth/signout -> 307, POST /en -> 405. Se usa status 303 (See Other), el
  // código estándar para "redirige y cambia a GET" tras un POST -- mismo
  // patrón que cualquier flujo POST-then-redirect (ej. logout, submit de
  // formulario clásico).
  return NextResponse.redirect(new URL(`/${locale}`, request.url), 303);
}

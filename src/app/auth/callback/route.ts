import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { isAllowedInternalPath } from "@/lib/safe-redirect";

// Fix (auditoría 2026-07-31, hallazgo confirmado): antes se usaban
// placeholders silenciosos si faltaban las env vars de Supabase -- este es
// el callback de OAuth (Google/Apple), el punto donde se intercambia el
// `code` por una sesión real; un fallo silencioso aquí deja al usuario sin
// sesión y sin ningún mensaje claro de por qué. Mismo patrón que
// src/lib/admin.ts y src/app/api/stripe/confirm/route.ts (commit d34b1cc):
// el throw vive DENTRO de funciones que se evalúan en tiempo de ejecución
// (cuando el handler GET realmente corre), no a nivel de módulo, para no
// arriesgar el build estático de Next.js si el entorno de build no tiene
// las mismas env vars que runtime.
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

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const providerError = requestUrl.searchParams.get("error");
  const rawNext = requestUrl.searchParams.get("next") || "/cotizador";
  // Auditoría v8.3 E0 (2026-07-11): `next` venía de un query param y se usaba
  // sin validar en new URL(next, request.url). Si `next` es una URL absoluta
  // (https://evil.com) o protocol-relative (//evil.com), new URL() la toma
  // tal cual e ignora el base -- open redirect clásico: alguien arma un link
  // de login legítimo con next=https://sitio-malicioso.com y, tras
  // autenticar de verdad, el navegador termina en el sitio del atacante.
  // Solo se permiten rutas relativas que empiecen con "/" y no con "//".
  //
  // Fix (auditoría de autenticación 2026-07-25/26, item 6): ese chequeo
  // bloquea un origen externo, pero no garantiza que el destino sea una
  // ruta interna VÁLIDA del proyecto (cualquier ruta relativa arbitraria
  // pasaba). isAllowedInternalPath (src/lib/safe-redirect.ts) restringe a
  // /{locale}/{sección conocida} usando la lista real de locales
  // (src/i18n/config.ts) y de secciones bajo src/app/[locale]/.
  const next = isAllowedInternalPath(rawNext) ? rawNext : "/cotizador";

  // v8.3 fix (auditoría 2026-07-15): si el proveedor OAuth (Google/Apple)
  // devuelve un error -- usuario cancela el consentimiento, cuenta
  // bloqueada, etc. -- este handler antes ignoraba por completo el caso
  // `if (code)` y hacía un redirect "exitoso" como si nada hubiera pasado.
  // El usuario terminaba de vuelta en el cotizador SIN sesión y sin ningún
  // mensaje, indistinguible de un botón roto.
  if (providerError && !code) {
    const errorUrl = new URL(next, request.url);
    errorUrl.searchParams.set("auth_error", "provider_error");
    return NextResponse.redirect(errorUrl);
  }

  if (!code) {
    // Ni code ni error -- callback inválido/directo. No hay nada que
    // intercambiar; redirigir sin fingir éxito silencioso tampoco aquí.
    const errorUrl = new URL(next, request.url);
    errorUrl.searchParams.set("auth_error", "missing_code");
    return NextResponse.redirect(errorUrl);
  }

  if (code) {
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
              cookieStore.set({ name, value, ...options, httpOnly: true, secure: process.env.NODE_ENV === "production" ? true : false, sameSite: "lax" });
            },
            remove(name: string, options: CookieOptions) {
              cookieStore.set({ name, value: "", ...options, httpOnly: true, secure: process.env.NODE_ENV === "production" ? true : false, sameSite: "lax" });
            },
          },
        }
      );
      await supabase.auth.exchangeCodeForSession(code);
    } catch (err) {
      // Fix (auditoría 2026-07-31): el try ahora también envuelve la
      // construcción del cliente (getSupabaseUrl()/getSupabaseAnonKey()
      // pueden lanzar si falta config), no solo exchangeCodeForSession --
      // mismo mensaje de error hacia el usuario en ambos casos, ya que
      // ninguno de los dos es distinguible/accionable desde el navegador.
      console.error("Auth callback exchange error:", err);
      // Redirect to login with error parameter
      const errorUrl = new URL(next, request.url);
      errorUrl.searchParams.set("auth_error", "session_exchange_failed");
      return NextResponse.redirect(errorUrl);
    }
  }

  return NextResponse.redirect(new URL(next, request.url));
}

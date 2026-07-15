import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder";

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
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/cotizador";

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
    const cookieStore = cookies();
    const supabase = createServerClient(
      supabaseUrl,
      supabaseKey,
      {
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
      }
    );
    try {
      await supabase.auth.exchangeCodeForSession(code);
    } catch (err) {
      console.error("Auth callback exchange error:", err);
      // Redirect to login with error parameter
      const errorUrl = new URL(next, request.url);
      errorUrl.searchParams.set("auth_error", "session_exchange_failed");
      return NextResponse.redirect(errorUrl);
    }
  }

  return NextResponse.redirect(new URL(next, request.url));
}

import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { type NextRequest, type NextResponse } from "next/server";
import { captureError } from "@/lib/observability";
import { getSupabaseUrl, getSupabaseAnonKey } from "@/lib/supabase-env";

/**
 * Crea un cliente de Supabase server-side, llama a `getUser()` (que fuerza
 * validación/refresh contra Auth, no solo lee el cookie local), escribe las
 * cookies resultantes en `response`, y devuelve el usuario resuelto (o
 * `null` si no hay sesión o si Auth está caído).
 *
 * Este es el patrón oficial de `@supabase/ssr` para Next.js App Router: el
 * refresh real de token DEBE ocurrir en middleware, el único lugar del
 * pipeline que puede escribir cookies en la response.
 *
 * @param request  — NextRequest entrante (para leer cookies)
 * @param response — NextResponse donde se escribirán las cookies refrescadas
 * @param context  — etiqueta para `captureError` (distingue call sites)
 * @returns User si hay sesión válida, null en caso contrario
 */
export async function refreshSession(
  request: NextRequest,
  response: NextResponse,
  context = "refreshSession",
): Promise<User | null> {
  try {
    const supabase = createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user;
  } catch (err) {
    captureError(err, { middleware: context });
    return null;
  }
}

// Fix (auditoría 2026-08-01, patrón sistémico ~146 archivos): la mayoría de
// las rutas API server-side instanciaban su cliente Supabase así:
//
//   const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
//   const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder";
//
// Si faltaba una env var en producción (misconfiguración real), el fallback
// dejaba el endpoint "funcionando" en apariencia -- pero cualquier
// auth.getUser()/query contra "https://placeholder.supabase.co" fallaba
// después de forma confusa (error de red/DNS) en vez de señalar la causa
// real de inmediato. Este módulo centraliza el acceso a esas env vars:
// lanza un error explícito y claro si faltan.
//
// IMPORTANTE: estas funciones deben llamarse en tiempo de EJECUCIÓN (dentro
// de un handler o de una función invocada por un handler), nunca asignadas
// a una constante a nivel de módulo (`const url = getSupabaseUrl()` fuera de
// una función). Next.js analiza estáticamente los imports/módulos en build
// time; un throw a nivel de módulo puede romper el build aunque las env
// vars sí estén configuradas en el entorno de ejecución real (solo faltan
// en el entorno de build). Mismo patrón ya usado en src/lib/admin.ts y en
// src/app/api/stripe/confirm/route.ts (commit d34b1cc).
export function getSupabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL no está configurado");
  }
  return url;
}

export function getSupabaseAnonKey(): string {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY no está configurado");
  }
  return key;
}

export function getSupabaseServiceKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY no está configurado");
  }
  return key;
}

// ─── Cliente Supabase para Route Handlers ───────────────────────────────
//
// Reemplaza las ~78 copias de getSupabaseClient() distribuidas por todas
// las rutas API. Uso canónico dentro de un handler:
//
//   import { createRouteSupabaseClient } from "@/lib/supabase-server";
//   const supabase = createRouteSupabaseClient();

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import type { SupabaseClient } from "@supabase/supabase-js";

export function createRouteSupabaseClient(): SupabaseClient<any, "public", any> {
  const cookieStore = cookies();
  return createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        cookieStore.set({ name, value, ...options, secure: true, sameSite: "lax" });
      },
      remove(name: string, options: CookieOptions) {
        cookieStore.set({ name, value: "", ...options, secure: true, sameSite: "lax" });
      },
    },
  });
}

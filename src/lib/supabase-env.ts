// Módulo centralizado de resolución de variables de entorno de Supabase.
// Extraído de src/lib/admin.ts y src/middleware.ts (auditoría 2026-08-07)
// para eliminar duplicación.  Ambas ubicaciones tenían copias idénticas de
// getSupabaseUrl() y getSupabaseAnonKey() con los mismos mensajes de error,
// misma semántica de throw, y mismo patrón de lazy evaluation.
//
// El throw vive dentro de estas funciones — evaluadas en tiempo de EJECUCIÓN,
// la primera vez que una request real las invoca — nunca a nivel de módulo.
// Next.js analiza/empaqueta los imports en build time y un throw top-level
// rompería el build aunque las env vars estén bien en runtime.
//
// Callers: src/lib/admin.ts, src/middleware.ts, y cualquier otro que necesite
// las env vars de Supabase con validación explícita.

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

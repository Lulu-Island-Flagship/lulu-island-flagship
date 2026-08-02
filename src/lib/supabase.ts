import { createBrowserClient } from "@supabase/ssr";

// Fix (auditoría de seguridad externa, 2026-08-01): antes, si faltaban las
// env vars de Supabase en producción (misconfiguración real), se caía en
// silencio a "https://placeholder.supabase.co" / "placeholder" -- el cliente
// browser seguía "funcionando" (no lanzaba nada) pero cualquier
// auth/query contra ese host inexistente fallaba de forma confusa (error de
// red/DNS) en vez de señalar la causa real, y en el peor caso enmascara un
// despliegue roto. Mismo patrón ya aplicado en src/lib/admin.ts
// (getSupabaseUrl/getSupabaseAnonKey): se lanza un error explícito.
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

export const supabase = createBrowserClient(getSupabaseUrl(), getSupabaseAnonKey());

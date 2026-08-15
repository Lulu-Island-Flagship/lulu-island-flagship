import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Módulo genérico: factory de cliente Supabase con service role key compartida.
// Extraído de hiring-flow/settings-service.ts (v0.4.1) porque la función es
// neutra de dominio: no pertenece a "hiring-flow", pertenece a la capa de
// infraestructura común. Cualquier módulo del sistema que necesite un
// cliente admin con SUPABASE_SERVICE_ROLE_KEY debería importar de acá, no
// de un módulo de dominio específico.

// Fix (auditoría de seguridad externa, 2026-08-01): antes, si faltaba
// NEXT_PUBLIC_SUPABASE_URL, se caía en silencio a
// "https://placeholder.supabase.co". Aquí es más grave que en otros lugares
// del repo: getHiringFlowServiceClient() (abajo) sigue devolviendo un
// cliente "válido" mientras SUPABASE_SERVICE_ROLE_KEY exista, así que la
// service role key REAL viajaría hacia ese dominio placeholder inexistente
// en vez de fallar de forma explícita. Se lanza un error claro en vez de
// permitir esa fuga silenciosa. Mismo patrón que src/lib/admin.ts.
function getSupabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL no está configurado");
  }
  return url;
}

// Replica EXACTAMENTE el patrón de getServiceRoleClient() en src/lib/admin.ts:
// misma env var, mismo manejo de ausencia -> null.
export function getHiringFlowServiceClient(): SupabaseClient | null {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return null;
  return createClient(getSupabaseUrl(), serviceKey);
}

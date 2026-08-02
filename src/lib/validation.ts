/**
 * Fix (auditoría de integridad de datos 2026-08-01): regex UUID v4/general
 * compartido para validar `params.id` / `body.id` antes de usarlos en
 * queries Supabase. Mismo patrón que ya existía duplicado en varios routes
 * (ej. src/app/api/admin/wallet/route.ts, src/app/api/client/wallet/apply/
 * route.ts) -- centralizado aquí para reuso en el resto de rutas [id] que
 * todavía no lo tenían.
 */
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value);
}

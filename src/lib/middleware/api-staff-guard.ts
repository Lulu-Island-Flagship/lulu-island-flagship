/**
 * Prefijos de API que requieren sesión de Supabase verificada en middleware
 * como defensa en profundidad adicional a la autorización granular que ya
 * hace cada route handler (requireAdminRole / requireActiveEmployee /
 * getUser manual + 401).
 */
const API_STAFF_PROTECTED_PREFIXES = [
  "/api/admin",
  "/api/employee",
  "/api/client",
] as const;

/**
 * Rutas de API que son públicas por diseño y NO requieren sesión, incluso
 * si caen bajo un prefijo protegido:
 *
 * - `/api/admin/backup-codes/verify`: mecanismo de recuperación cuando un
 *   owner_admin pierde acceso a su sesión de Google.
 * - `/api/client/review`: review_token single-use de 24h atado a orden.
 *
 * Se comparan por pathname exacto normalizado (sin barra final, lowercase)
 * para evitar bypass por `/api/client/review/` u otras variantes.
 */
const PUBLIC_API_EXCEPTIONS = [
  "/api/admin/backup-codes/verify",
  "/api/client/review",
] as const;

/**
 * @returns true si `pathname` pertenece a un prefijo de API protegido
 *          (`/api/admin`, `/api/employee`, `/api/client`)
 */
export function isProtectedApiRoute(pathname: string): boolean {
  return API_STAFF_PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * @returns true si `pathname` (ya normalizado: sin barra final, lowercase)
 *          coincide con una ruta de API pública exceptuada
 */
export function isPublicApiRoute(normalizedPathname: string): boolean {
  return (PUBLIC_API_EXCEPTIONS as readonly string[]).includes(normalizedPathname);
}

/**
 * Prefijos de página (sin locale) que requieren que el visitante tenga
 * sesión de staff. La verificación de rol específico (admin vs employee)
 * sigue viviendo en cada layout/API vía requireAdminRole() /
 * resolveStaffLogin(); acá solo se verifica que EXISTA sesión.
 */
const STAFF_PROTECTED_PREFIXES = ["/admin", "/employee"] as const;

/**
 * Prefijos de página (sin locale) que requieren que el visitante tenga
 * sesión de cliente. La distinción cliente-autenticado vs staff-autenticado
 * (AuthModal / redirect a /portal) la sigue resolviendo cuenta/layout.tsx;
 * acá solo se verifica que EXISTA sesión.
 */
const CLIENT_PROTECTED_PREFIXES = ["/account"] as const;

/**
 * @param pathWithoutLocale — pathname sin el segmento de locale
 *   (ej. "/admin/dashboard" en vez de "/en/admin/dashboard")
 * @returns true si el path cae bajo `/admin` o `/employee`
 */
export function requiresStaffAuth(pathWithoutLocale: string): boolean {
  return STAFF_PROTECTED_PREFIXES.some(
    (prefix) =>
      pathWithoutLocale === prefix ||
      pathWithoutLocale.startsWith(`${prefix}/`),
  );
}

/**
 * @param pathWithoutLocale — pathname sin el segmento de locale
 *   (ej. "/account/profile" en vez de "/en/account/profile")
 * @returns true si el path cae bajo `/account`
 */
export function requiresClientAuth(pathWithoutLocale: string): boolean {
  return CLIENT_PROTECTED_PREFIXES.some(
    (prefix) =>
      pathWithoutLocale === prefix ||
      pathWithoutLocale.startsWith(`${prefix}/`),
  );
}

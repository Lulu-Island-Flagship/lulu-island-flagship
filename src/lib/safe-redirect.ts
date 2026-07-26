import { locales } from "@/i18n/config";

/**
 * Fix (auditoría de autenticación 2026-07-25/26, item 6): src/middleware.ts
 * construye `nextParam` a partir de pathname+search sin sanitizar antes de
 * pasarlo a /portal, y tanto /portal (src/app/[locale]/portal/page.tsx) como
 * /auth/callback (src/app/auth/callback/route.ts) solo validaban que `next`
 * empezara con "/" y no con "//" -- suficiente para bloquear un open
 * redirect a un origen externo (https://evil.com, //evil.com), pero no
 * garantiza que el destino sea una ruta interna VÁLIDA del proyecto. Esta
 * allowlist restringe `next` a un patrón conocido de locale + sección real
 * (ver carpetas bajo src/app/[locale]/ y src/i18n/config.ts para la lista de
 * locales) antes de honrarlo; si no matchea, el llamador debe caer a una
 * ruta segura por defecto.
 *
 * Se mantiene como único punto de verdad (en vez de repetir el regex en los
 * 3 lugares que consumen `next`) para que agregar una sección nueva no
 * requiera tocar cada validación por separado.
 */
const KNOWN_SECTIONS = [
  "empleado",
  "admin",
  "cuenta",
  "cotizador",
  "reserva",
  "confirmacion",
  "portal",
  "evaluar",
  "encuesta",
  "nps",
  "terminos",
  "privacidad",
  "cancelacion",
] as const;

const ALLOWED_INTERNAL_PATH_RE = new RegExp(
  `^/(${locales.join("|")})(/(${KNOWN_SECTIONS.join("|")})(/.*)?)?$`
);

/**
 * true si `path` es una ruta interna relativa segura para redirigir (no un
 * origen externo, no protocol-relative, y coincide con /{locale}/{sección
 * conocida}(/...) o la raíz de un locale).
 */
export function isAllowedInternalPath(path: string | null | undefined): path is string {
  if (!path) return false;
  if (!path.startsWith("/") || path.startsWith("//")) return false;
  return ALLOWED_INTERNAL_PATH_RE.test(path);
}

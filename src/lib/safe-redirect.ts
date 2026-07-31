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
 *
 * Fix (revisión 2026-07-30, punto 2): ALLOWED_INTERNAL_PATH_RE se valida
 * solo contra la parte de path (antes de "?"/"#"), no contra el string
 * completo -- antes un `next` con query string en la raíz de una sección
 * (p.ej. "/en/cotizador?step=2") se rechazaba porque el regex exigía `$`
 * inmediatamente después de la sección sin dejar lugar a un "?...". La
 * allowlist de secciones/locale sigue siendo la misma (ver comentario de
 * ALLOWED_INTERNAL_PATH_RE), así que esto no abre superficie nueva de open
 * redirect -- solo el query string (y el hash) pueden variar, y ahí se
 * rechaza cualquier "//" o "@" para que ni siquiera un query manipulado
 * pueda inducir una interpretación de URL con otro origen.
 */
export function isAllowedInternalPath(path: string | null | undefined): path is string {
  if (!path) return false;
  if (!path.startsWith("/") || path.startsWith("//")) return false;

  const hashIndex = path.indexOf("#");
  const withoutHash = hashIndex === -1 ? path : path.slice(0, hashIndex);
  const queryIndex = withoutHash.indexOf("?");
  const basePath = queryIndex === -1 ? withoutHash : withoutHash.slice(0, queryIndex);
  const queryAndHash = path.slice(basePath.length);

  if (!ALLOWED_INTERNAL_PATH_RE.test(basePath)) return false;
  // Defensa en profundidad: el query string/hash no debe poder colar un
  // "//" (protocol-relative) ni un "@" (userinfo, usado para disfrazar el
  // host real en algunos parsers de URL laxos).
  if (/\/\/|@/.test(queryAndHash)) return false;
  return true;
}

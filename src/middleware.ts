import createIntlMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { locales, defaultLocale } from "./i18n/config";
import { isAllowedInternalPath } from "./lib/safe-redirect";
import { refreshSession } from "./lib/middleware/session-refresh";
import {
  isProtectedApiRoute,
  isPublicApiRoute,
} from "./lib/middleware/api-staff-guard";
import {
  requiresStaffAuth,
  requiresClientAuth,
} from "./lib/middleware/page-guard";
import {
  injectPathnameHeader,
  injectObservabilityHeaders,
} from "./lib/middleware/headers";

// v8.3 E0 (2026-07-11): antes este archivo SOLO hacía ruteo de idioma.
// Auditoría (interna y externa) encontró que no había refresh de sesión de
// Supabase en ningún lado del request pipeline -- cada Server Component
// (admin/layout.tsx, lib/admin.ts) intentaba refrescar el token por su
// cuenta y Next.js se lo bloqueaba ("Cookies can only be modified in a
// Server Action or Route Handler"), dejando esos intentos como no-ops
// silenciosos. Resultado: el usuario podía perder la sesión sin aviso en
// cuanto el access token expirara, porque nunca se refrescaba de verdad.
// Este es el patrón oficial de @supabase/ssr para Next.js App Router: el
// refresh real ocurre AQUÍ, en middleware, que sí puede escribir cookies en
// la response. Los try/catch silenciosos en layout.tsx y admin.ts siguen
// como red de seguridad (por si acaso), pero ya no son la única defensa.
const intlMiddleware = createIntlMiddleware({
  locales,
  defaultLocale,
  localePrefix: "always",
});

export default async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // ── Paso 1: API pública exceptuada (antes de cualquier chequeo de sesión) ──
  //
  // /api/admin/backup-codes/verify es EL mecanismo de recuperación cuando un
  // owner_admin pierde acceso a su sesión de Google -- no requiere sesión previa.
  // /api/client/review es público por diseño (review_token single-use, 24h).
  // Se normaliza pathname (quita barras finales, lowercase) para evitar bypass.
  const normalizedPathname = pathname.replace(/\/+$/, "").toLowerCase();
  if (isPublicApiRoute(normalizedPathname)) {
    return NextResponse.next();
  }

  // ── Paso 2: API staff protegida (defensa en profundidad para /api/admin,
  //    /api/employee, /api/client) ──
  //
  // Este bloque NO reemplaza la autorización granular (rol exacto, RBAC por
  // recurso) que ya hace cada route.ts -- solo verifica que EXISTA una sesión
  // de Supabase válida. Se responde ANTES de invocar intlMiddleware porque
  // next-intl no sabe rutear /api/** (no tiene locale prefix).
  if (isProtectedApiRoute(pathname)) {
    const apiResponse = NextResponse.next();

    // refreshSession crea el server client, llama a getUser() (validación
    // real contra Auth, no solo lectura local del cookie), y escribe las
    // cookies refrescadas en apiResponse. Si falla (Auth caído, env vars
    // faltantes, timeout) devuelve null -- se falla cerrado con 401.
    const apiUser = await refreshSession(request, apiResponse, "isApiStaffProtected");

    if (!apiUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return apiResponse;
  }

  // ── Paso 3: i18n routing ──
  const response = intlMiddleware(request) ?? NextResponse.next();

  // ── Paso 4: Refresh de sesión para páginas ──
  //
  // getUser() (no getSession()) fuerza la validación/refresh contra Auth.
  // Si Auth está caído, se degrada a "sin sesión" (user = null): el resto
  // del pipeline ya sabe tratar a un visitante anónimo (redirect a /portal
  // o al home según la sección, o simplemente deja pasar si la ruta es
  // pública).
  const user = await refreshSession(request, response, "getUser");

  // ── Paso 5: Extracción de locale ──
  const pathnameParts = pathname.split("/").filter(Boolean);
  const localeInPath = locales.includes(
    pathnameParts[0] as (typeof locales)[number],
  )
    ? pathnameParts[0]
    : defaultLocale;
  const pathWithoutLocale =
    "/" +
    pathnameParts
      .slice(localeInPath === pathnameParts[0] ? 1 : 0)
      .join("/");

  // ── Paso 6: Page guards ──
  //
  // Defensa en profundidad: redirige ANTES de que el Server Component
  // renderice, al mismo destino que los layouts ya usan hoy. No se duplica
  // lógica de rol -- eso lo sigue decidiendo cada layout/API; acá solo se
  // verifica que EXISTA sesión.

  // Staff: /admin, /employee → redirect a /portal
  if (requiresStaffAuth(pathWithoutLocale) && !user) {
    const nextParam = `${pathname}${request.nextUrl.search}`;
    const loginUrl = new URL(`/${localeInPath}/portal`, request.url);
    if (isAllowedInternalPath(nextParam)) {
      loginUrl.searchParams.set("next", nextParam);
    }
    return NextResponse.redirect(loginUrl);
  }

  // Client: /account → redirect al home
  if (requiresClientAuth(pathWithoutLocale) && !user) {
    const nextParam = `${pathname}${request.nextUrl.search}`;
    const homeUrl = new URL(`/${localeInPath}`, request.url);
    if (isAllowedInternalPath(nextParam)) {
      homeUrl.searchParams.set("next", nextParam);
    }
    return NextResponse.redirect(homeUrl);
  }

  // ── Paso 7: Headers ──
  //
  // x-pathname: Server Components (admin/layout.tsx) necesitan el pathname
  // real para detectar el locale; este es el único lugar del pipeline con
  // acceso simultáneo a NextRequest y a la response.
  injectPathnameHeader(request, response);

  // Capa 0: Communication Observability — propaga contexto de negocio para
  // que sistemas downstream puedan trazar qué objeto disparó una
  // comunicación sin acoplar módulos.
  injectObservabilityHeaders(response);

  return response;
}

export const config = {
  matcher: [
    "/((?!api|auth|_next|.*\\..*).*)",
    // Estos tres prefijos SÍ deben pasar por el middleware (ver Paso 2
    // arriba) como red de seguridad adicional a la autorización que ya hace
    // cada endpoint. El resto de /api (quote, auth, stripe, cron, public,
    // cuenta/access-check, staff/resolve-login) queda deliberadamente
    // excluido -- son rutas públicas, webhooks firmados, o jobs de cron con
    // su propio secreto.
    "/api/admin/:path*",
    "/api/employee/:path*",
    "/api/client/:path*",
  ],
};

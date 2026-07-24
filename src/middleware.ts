import createIntlMiddleware from 'next-intl/middleware';
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { locales, defaultLocale } from './i18n/config';

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
  localePrefix: 'always',
});

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder';

export default async function middleware(request: NextRequest) {
  const response = intlMiddleware(request) ?? NextResponse.next();

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      get(name: string) {
        return request.cookies.get(name)?.value;
      },
      set(name: string, value: string, options) {
        response.cookies.set({ name, value, ...options });
      },
      remove(name: string, options) {
        response.cookies.set({ name, value: '', ...options });
      },
    },
  });

  // getUser() (no getSession()) fuerza la validación/refresh contra Auth,
  // no solo lee el cookie local -- es la llamada que Supabase recomienda
  // acá específicamente para que el refresh de token ocurra de verdad.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Fix 2026-07-23 (auditoría de autenticación en middleware): confirmado
  // leyendo el archivo completo que este middleware SOLO hacía ruteo de
  // idioma + refresh de sesión -- nunca redirigía a nadie. Cualquiera podía
  // navegar directo a /[locale]/admin/**, /[locale]/empleado/** o
  // /[locale]/cuenta/** sin sesión; la única defensa real vivía más abajo,
  // en cada Server/Client Component, con los mismos try/catch que este
  // archivo ya documenta (arriba) como un patrón que en el pasado falló en
  // silencio. Este bloque añade defensa en profundidad para /admin y
  // /empleado, redirigiendo ANTES de que el Server Component llegue a
  // renderizar nada, al MISMO destino que esos layouts ya usan hoy
  // (admin/layout.tsx línea 68, empleado/layout.tsx línea 57-64): el portal
  // unificado /[locale]/portal?next=<ruta original>. No se duplica lógica
  // de rol -- eso lo sigue decidiendo cada layout/API vía
  // requireAdminRole()/resolveStaffLogin() (src/lib/admin.ts,
  // src/lib/staff-login.ts); acá solo se verifica que EXISTA sesión.
  //
  // /cuenta queda deliberadamente fuera de este redirect: no existe una URL
  // de login dedicada para clientes (se verificó leyendo cuenta/layout.tsx
  // -- es un Client Component que ya bloquea el render de {children} y
  // muestra AuthModal en la misma URL mientras no hay sesión, sin fuga de
  // datos porque no hay Server Component de por medio). Inventar una URL de
  // login nueva para redirigir ahí sería un cambio de UX no solicitado y
  // fuera del alcance de este fix; si en el futuro se agrega una ruta de
  // login real para clientes, este bloque debe extenderse para cubrirla.
  const pathname = request.nextUrl.pathname;
  const pathnameParts = pathname.split("/").filter(Boolean);
  const localeInPath = locales.includes(pathnameParts[0] as (typeof locales)[number])
    ? pathnameParts[0]
    : defaultLocale;
  const pathWithoutLocale = "/" + pathnameParts.slice(localeInPath === pathnameParts[0] ? 1 : 0).join("/");

  const staffProtectedPrefixes = ["/admin", "/empleado"];
  const isStaffProtected = staffProtectedPrefixes.some(
    (prefix) => pathWithoutLocale === prefix || pathWithoutLocale.startsWith(`${prefix}/`)
  );

  if (isStaffProtected && !user) {
    const nextParam = `${pathname}${request.nextUrl.search}`;
    const loginUrl = new URL(`/${localeInPath}/portal`, request.url);
    loginUrl.searchParams.set("next", nextParam);
    return NextResponse.redirect(loginUrl);
  }

  // v8.3 fix G-5: src/app/[locale]/admin/layout.tsx necesita el pathname
  // actual (para detectar el locale y setear AdminNav/mensajes en el idioma
  // correcto) pero, al ser un Server Component, no tiene acceso directo a la
  // URL del request -- solo puede leerlo de un header que alguien más tenga
  // que setear. Ese layout ya intentaba leer "x-invoke-path" (típico de
  // otros hostings) con fallback a "x-pathname", pero ningún lado del
  // pipeline seteaba NINGUNO de los dos -- el fallback hardcodeado a
  // "/en/admin" siempre ganaba, y el panel admin quedaba en inglés sin
  // importar el locale real de la URL. Este es el único lugar del pipeline
  // (middleware) con acceso simultáneo al NextRequest y a la response.
  response.headers.set("x-pathname", request.nextUrl.pathname);

  return response;
}

export const config = {
  matcher: ['/((?!api|auth|_next|.*\\..*).*)']
};
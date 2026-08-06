import createIntlMiddleware from 'next-intl/middleware';
import { createServerClient } from '@supabase/ssr';
import type { User } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { locales, defaultLocale } from './i18n/config';
import { isAllowedInternalPath } from './lib/safe-redirect';
import { captureError } from './lib/observability';

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

// Fix (auditoría 2026-07-31, hallazgo confirmado): antes se usaban
// placeholders silenciosos ("https://placeholder.supabase.co" / "placeholder")
// si faltaban las env vars de Supabase -- este middleware corre en TODA
// request de página y en los tres prefijos /api protegidos; un fallo
// silencioso acá significa que auth.getUser() nunca resuelve un usuario
// real y todo el pipeline de auth queda roto sin ningún indicio de por qué
// (parece simplemente "nadie tiene sesión"). El throw vive dentro de estas
// funciones -- evaluadas en tiempo de EJECUCIÓN, la primera vez que el
// middleware maneja una request real -- nunca a nivel de módulo, porque
// Next.js sí analiza/empaqueta middleware.ts en build time y un throw al
// importar podría romper el build aunque las env vars estén bien en
// runtime. Mismo patrón que src/lib/admin.ts y los route handlers de auth
// (commit d34b1cc y siguientes). Los call sites de abajo (dentro de
// `middleware()`) ahora están envueltos en try/catch (ver fix de "Auth caído
// no debe tirar 500" más abajo) así que un throw aquí se degrada a un
// redirect seguro en vez de tumbar la respuesta completa.
function getSupabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL no está configurado');
  }
  return url;
}

function getSupabaseAnonKey(): string {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY no está configurado');
  }
  return key;
}

export default async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Fix (auditoría 2026-07-30, defensa en profundidad para /api): el
  // `config.matcher` de este archivo excluía TODO /api/** del pipeline de
  // middleware (por diseño -- /api/quote, /api/auth, el webhook de Stripe,
  // los crons, etc. deben quedar fuera). El problema es que eso significa
  // que si algún endpoint bajo /api/admin, /api/employee o /api/client
  // llegara a olvidar su propio chequeo de sesión (requireAdminRole /
  // requireActiveEmployee / getUser()+401 manual, que HOY sí tiene cada uno
  // -- se verificó leyendo una muestra representativa), quedaría
  // completamente público sin ninguna red de seguridad adicional. Este
  // bloque NO reemplaza esa autorización granular (rol exacto, RBAC por
  // recurso) -- eso sigue viviendo en cada route.ts -- solo verifica que
  // EXISTA una sesión de Supabase válida antes de dejar pasar la request,
  // igual que ya se hace para las páginas /admin, /empleado y /cuenta más
  // abajo. Solo corre para los tres prefijos explícitamente agregados al
  // `config.matcher` (api/admin, api/empleado, api/client); el resto de
  // /api sigue completamente fuera de este archivo. Se responde ANTES de
  // invocar intlMiddleware porque next-intl no sabe rutear /api/** (no
  // tiene locale prefix) y podría intentar redirigir estas requests.
  const apiStaffProtectedPrefixes = ["/api/admin", "/api/employee", "/api/client"];
  const isApiStaffProtected = apiStaffProtectedPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );

  // Fix (auditoría 2026-07-31, bug real confirmado): /api/admin/backup-codes/verify
  // es EL mecanismo de recuperación cuando un owner_admin pierde acceso a su
  // sesión de Google -- por diseño no requiere sesión previa (ver comentario de
  // cabecera de ese route.ts). El bloque isApiStaffProtected de abajo exige sesión
  // Supabase válida para TODO /api/admin/**, así que sin esta excepción cualquier
  // intento de canjear un código de respaldo moría con 401 antes de que el
  // endpoint pudiera ejecutarse -- dejando el mecanismo de recuperación
  // completamente inutilizable. Se excluye por pathname EXACTO (no un prefijo
  // amplio) para no reabrir el resto de /api/admin/** a requests sin sesión.
  //
  // Fix (pentest 2026-08-02): /api/client/review también es público por diseño
  // (review_token single-use, 24h, atado a orden). El middleware lo bloqueaba con
  // 401, rompiendo el flujo de reseñas post-servicio. Se normaliza pathname
  // (quita barras finales, lowercase) antes de comparar para evitar bypass por
  // /api/client/review/ u otras variantes.
  const normalizedPathname = pathname.replace(/\/+$/, "").toLowerCase();
  const publicApiExceptions = ["/api/admin/backup-codes/verify", "/api/client/review"];
  if (publicApiExceptions.includes(normalizedPathname)) {
    return NextResponse.next();
  }

  if (isApiStaffProtected) {
    const apiResponse = NextResponse.next();

    // Fix (auditoría 2026-07-31, hallazgo confirmado): `await
    // supabase.auth.getUser()` no tenía try/catch -- si Supabase Auth está
    // caído, con timeout, o (tras el fix de arriba) las env vars faltan, la
    // excepción quedaba sin manejar y Next.js respondía con un 500 genérico
    // para TODO /api/admin, /api/employee y /api/client. Se falla cerrado
    // (401) en vez de crashear: sigue siendo la postura de seguridad
        // correcta (sin poder verificar sesión, no se deja pasar la request) y
    // el caller ya maneja 401 normalmente, a diferencia de un 500 sin
    // cuerpo interpretable.
    let apiUser: User | null = null;
    try {
      const supabaseApi = createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
        cookies: {
          get(name: string) {
            return request.cookies.get(name)?.value;
          },
          set(name: string, value: string, options) {
            apiResponse.cookies.set({ name, value, ...options, httpOnly: true, secure: true, sameSite: "lax" });
          },
          remove(name: string, options) {
            apiResponse.cookies.set({ name, value: '', ...options, httpOnly: true, secure: true, sameSite: "lax" });
          },
        },
      });

      const {
        data: { user },
      } = await supabaseApi.auth.getUser();
      apiUser = user;
    } catch (err) {
      captureError(err, { middleware: "isApiStaffProtected" });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!apiUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return apiResponse;
  }

  const response = intlMiddleware(request) ?? NextResponse.next();

  // Fix (auditoría 2026-07-31, hallazgo confirmado): mismo criterio que
  // arriba -- si Supabase Auth está caído, este bloque cubre TODA página
  // del sitio (matcher por defecto), así que un throw sin manejar acá
  // tumbaría el sitio entero. Se degrada a "sin sesión" (user = null) en vez
  // de 500: el resto del pipeline ya sabe tratar a un visitante sin sesión
  // (redirect a /portal o al home según la sección, o simplemente deja
  // pasar si la ruta es pública) -- es la misma UX que ya existe hoy para
  // cualquier visitante anónimo, en vez de una pantalla de error genérica.
  let user: User | null = null;
  try {
    const supabase = createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options) {
          response.cookies.set({ name, value, ...options, httpOnly: true, secure: true, sameSite: "lax" });
        },
        remove(name: string, options) {
          response.cookies.set({ name, value: '', ...options, httpOnly: true, secure: true, sameSite: "lax" });
        },
      },
    });

    // getUser() (no getSession()) fuerza la validación/refresh contra Auth,
    // no solo lee el cookie local -- es la llamada que Supabase recomienda
    // acá específicamente para que el refresh de token ocurra de verdad.
    const {
      data: { user: resolvedUser },
    } = await supabase.auth.getUser();
    user = resolvedUser;
  } catch (err) {
    captureError(err, { middleware: "getUser" });
  }

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
  // Fix (auditorías independientes, 2026-07-30, confirmado real): la nota
  // anterior decía que /cuenta quedaba deliberadamente fuera de este
  // redirect porque no hay una URL de login dedicada para clientes -- cierto,
  // pero eso solo cubre el caso con JS: cuenta/layout.tsx es un Client
  // Component, así que un visitante sin sesión igual recibe el HTML shell
  // completo (200 OK) del servidor y depende de que React monte, corra el
  // useEffect y muestre el AuthModal. Si JS falla o tarda (red lenta, error
  // de hidratación, bloqueador de scripts), ese usuario queda atascado en el
  // spinner de "checking" (línea ~109 de cuenta/layout.tsx) indefinidamente,
  // sin nunca ver ni el AuthModal ni ningún error. No hace falta inventar una
  // URL de login nueva para arreglar esto: basta con mandar al usuario sin
  // sesión de vuelta al home (misma sección seguridad que ya usa
  // isAllowedInternalPath), que sí es un Server Component real y no depende
  // de JS para existir. La distinción cliente-autenticado vs
  // staff-autenticado (AuthModal / redirect a /portal) la sigue resolviendo
  // cuenta/layout.tsx como hasta ahora -- acá, igual que para /admin y
  // /empleado, solo se verifica que EXISTA sesión.
  const pathnameParts = pathname.split("/").filter(Boolean);
  const localeInPath = locales.includes(pathnameParts[0] as (typeof locales)[number])
    ? pathnameParts[0]
    : defaultLocale;
  const pathWithoutLocale = "/" + pathnameParts.slice(localeInPath === pathnameParts[0] ? 1 : 0).join("/");

  const staffProtectedPrefixes = ["/admin", "/employee"];
  const isStaffProtected = staffProtectedPrefixes.some(
    (prefix) => pathWithoutLocale === prefix || pathWithoutLocale.startsWith(`${prefix}/`)
  );

  if (isStaffProtected && !user) {
    const nextParam = `${pathname}${request.nextUrl.search}`;
    const loginUrl = new URL(`/${localeInPath}/portal`, request.url);
    // Fix (auditoría de autenticación 2026-07-25/26, item 6): antes se
    // pasaba nextParam sin sanitizar. En la práctica pathname siempre cae
    // bajo /admin o /empleado (por isStaffProtected arriba), así que ya era
    // interno -- pero se agrega la misma allowlist que usan /portal y
    // /auth/callback como defensa en profundidad, por si este bloque se
    // reutiliza o se relaja en el futuro. Si no matchea, se cae al Portal
    // sin `next` (destino seguro por defecto).
    if (isAllowedInternalPath(nextParam)) {
      loginUrl.searchParams.set("next", nextParam);
    }
    return NextResponse.redirect(loginUrl);
  }

  const clientProtectedPrefixes = ["/account"];
  const isClientProtected = clientProtectedPrefixes.some(
    (prefix) => pathWithoutLocale === prefix || pathWithoutLocale.startsWith(`${prefix}/`)
  );

  if (isClientProtected && !user) {
    const nextParam = `${pathname}${request.nextUrl.search}`;
    const homeUrl = new URL(`/${localeInPath}`, request.url);
    // Igual que arriba: se preserva `next` para uso futuro (p.ej. si se
    // agrega una ruta de login real para clientes que lo consuma), pero el
    // destino seguro por defecto es el home, que no requiere `next` para
    // funcionar.
    if (isAllowedInternalPath(nextParam)) {
      homeUrl.searchParams.set("next", nextParam);
    }
    return NextResponse.redirect(homeUrl);
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

  // Capa 0: Communication Observability headers
  // Propagate business context so downstream systems can trace which
  // business object triggered a communication, without coupling modules.
  response.headers.set("X-Business-Context", "ready");
  response.headers.set("X-Emitted-By", "middleware");

  return response;
}

export const config = {
  matcher: [
    '/((?!api|auth|_next|.*\\..*).*)',
    // Fix (auditoría 2026-07-30): estos tres prefijos SÍ deben pasar por el
    // middleware (ver bloque isApiStaffProtected arriba) como red de
    // seguridad adicional a la autorización que ya hace cada endpoint. El
    // resto de /api (quote, auth, stripe, cron, public, cuenta/access-check,
    // staff/resolve-login) queda deliberadamente excluido -- son rutas
    // públicas, webhooks firmados, o jobs de cron con su propio secreto.
    '/api/admin/:path*',
    '/api/employee/:path*',
    '/api/client/:path*',
  ]
};
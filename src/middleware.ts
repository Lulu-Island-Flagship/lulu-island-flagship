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
  await supabase.auth.getUser();

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
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { locales, defaultLocale } from "@/i18n/config";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder";

// v8.3 fix M-8 (auditoría implacable 2026-07-20b): antes siempre
// redirigía a "/" a secas -- un usuario en /fr/admin/... terminaba en /en
// (locale por defecto del middleware) tras cerrar sesión, perdiendo su
// idioma. Esta Route Handler no conoce el locale del request salvo que
// alguien se lo pase explícitamente: se lee primero de ?locale= (el
// trigger de logout en admin/layout.tsx ahora lo manda, ver
// src/app/[locale]/admin/layout.tsx) y, si falta o no es válido, se
// intenta derivar del primer segmento del Referer -- solo como fallback,
// nunca como fuente primaria, porque el Referer puede faltar (algunos
// navegadores/extensiones lo bloquean) o venir de otro origen.
function resolveSignoutLocale(request: NextRequest): string {
  const queryLocale = request.nextUrl.searchParams.get("locale");
  if (queryLocale && (locales as readonly string[]).includes(queryLocale)) {
    return queryLocale;
  }

  const referer = request.headers.get("referer");
  if (referer) {
    try {
      const refererPath = new URL(referer).pathname;
      const candidate = refererPath.split("/")[1];
      if (candidate && (locales as readonly string[]).includes(candidate)) {
        return candidate;
      }
    } catch {
      // Referer inválido/no parseable -- se ignora, cae al default.
    }
  }

  return defaultLocale;
}

export async function POST(request: NextRequest) {
  const locale = resolveSignoutLocale(request);
  const cookieStore = cookies();
  const supabase = createServerClient(
    supabaseUrl,
    supabaseKey,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          cookieStore.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          cookieStore.set({ name, value: "", ...options });
        },
      },
    }
  );

  await supabase.auth.signOut();
  return NextResponse.redirect(
    new URL(`/${locale}`, process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000")
  );
}

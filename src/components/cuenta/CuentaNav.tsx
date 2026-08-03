"use client";

// Nav compartida de /cuenta (v8.3 fix, auditoría 2026-07-24): las 5
// subpáginas del área de cliente (servicios, propiedades, billetera,
// referidos, preferencias) no tenían navegación entre sí -- cada una era
// una isla, solo alcanzable si el usuario sabía o recordaba la URL exacta
// (o llegaba desde un link cruzado puntual como "Manage my properties" en
// servicios). Este componente se monta una sola vez en cuenta/layout.tsx y
// aparece en las 5 páginas sin duplicar código.
//
// Móvil-first: el sitio es de uso mayormente móvil (ver comentarios de
// auditoría en empleado/page.tsx y cuenta/layout.tsx). Se usa una barra
// horizontal con scroll-x en vez de un menú hamburguesa -- todas las
// secciones quedan visibles/descubribles con un swipe, sin un tap extra
// para abrir un menú, y sin la complejidad de un overlay a construir aquí.
//
// Logout (actualizado, auditoría de autenticación 2026-07-25/26, item 4):
// ya NO cierra sesión directo desde el navegador con supabase.auth.signOut()
// -- usa el mismo endpoint POST /auth/signout que /admin (form POST, ver
// más abajo). cuenta/layout.tsx sigue detectando la sesión perdida vía
// onAuthStateChange y vuelve a mostrar el AuthModal automáticamente una vez
// que /auth/signout limpia las cookies y redirige.
import React, { useState } from "react";
import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, Wrench, Home, Wallet, Gift, Settings, LogOut, User } from "lucide-react";

const SECTIONS = [
  { key: "servicios", href: "servicios", icon: Wrench },
  { key: "propiedades", href: "propiedades", icon: Home },
  { key: "billetera", href: "billetera", icon: Wallet },
  { key: "referidos", href: "referidos", icon: Gift },
  { key: "preferencias", href: "preferencias", icon: Settings },
  { key: "perfil", href: "perfil", icon: User },
] as const;

export function CuentaNav() {
  const t = useTranslations("cuenta.nav");
  const pathname = usePathname();
  const params = useParams();
  const locale = (params?.locale as string) || "en";
  // Fix (revisión 2026-07-30, punto 6): el <form action="/auth/signout">
  // (POST normal, sin JS) navegaba directo a la respuesta del endpoint --
  // si el POST fallaba a nivel de red (offline, timeout), el usuario solo
  // veía la pantalla de error nativa del navegador, sin ningún mensaje del
  // producto ni forma de reintentar sin recargar todo. Se intercepta el
  // submit para poder mostrar un error propio y dejar reintentar; el POST
  // real sigue siendo al mismo endpoint (src/app/auth/signout/route.ts), que
  // siempre redirige tras limpiar cookies -- solo agregamos manejo del caso
  // en que la request ni siquiera llegue a completarse.
  const [signoutError, setSignoutError] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignout(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSigningOut(true);
    setSignoutError(false);
    try {
      const res = await fetch(`/auth/signout?locale=${locale}`, { method: "POST", redirect: "follow" });
      // El endpoint siempre responde con un redirect exitoso (ver route.ts) --
      // solo tratamos como error un fallo real de red/HTTP.
      if (!res.ok) {
        setSignoutError(true);
        setSigningOut(false);
        return;
      }
      window.location.href = res.url || `/${locale}`;
    } catch {
      setSignoutError(true);
      setSigningOut(false);
    }
  }

  // Fix (auditoría de autenticación 2026-07-25/26, item 4): antes cerraba
  // sesión directo desde el navegador con supabase.auth.signOut(), distinto
  // al patrón ya usado en /admin (form POST a /auth/signout, ver
  // src/app/[locale]/admin/layout.tsx). Se unifica al mismo endpoint server-
  // side -- limpia las cookies de sesión de forma consistente y evita tener
  // dos mecanismos de logout distintos en el mismo proyecto. Se usa un
  // <form> normal (no fetch) para que el POST + redirect final de esa Route
  // Handler funcione igual que en /admin.
  // Fix (auditoría en vivo 2026-08-01, UX): antes esta barra era un único
  // <div overflow-x-auto> de max-w-lg con las 5 secciones + logout adentro
  // -- en desktop, con 6 items, "Log out" quedaba fuera del ancho visible y
  // la única pista de que había más contenido era un hilo gris de 2px bajo
  // la barra (nada descubrible; hubo que hacer scroll manual para
  // encontrarlo). Tampoco existía NINGÚN link de vuelta al sitio/home en
  // toda el área /cuenta -- solo el botón atrás del navegador. Se separa la
  // barra en 3 zonas: "Volver a home" fijo a la izquierda, las 5 secciones
  // en su propio contenedor con scroll-x (el scroll horizontal sigue siendo
  // el patrón correcto en móvil, ver comentario de arriba), y "Log out" fijo
  // a la derecha -- ninguno de los dos extremos se pierde nunca por scroll.
  return (
    <nav
      aria-label={t("ariaLabel")}
      className="sticky top-0 z-20 bg-white border-b border-gray-200 shadow-elevation-1"
    >
      <div className="max-w-3xl mx-auto flex items-stretch">
        <Link
          href={`/${locale}`}
          aria-label={t("backToHome")}
          className="flex flex-col items-center justify-center gap-1 px-3 py-2.5 min-w-[56px] shrink-0 text-xs font-medium text-gray-400 hover:text-brand-navy transition-colors border-r border-gray-100"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex items-stretch overflow-x-auto min-w-0 flex-1">
          {SECTIONS.map(({ key, href, icon: Icon }) => {
            const isActive = pathname?.includes(`/cuenta/${href}`);
            return (
              <Link
                key={key}
                href={`/${locale}/cuenta/${href}`}
                aria-current={isActive ? "page" : undefined}
                className={`flex flex-col items-center justify-center gap-1 px-4 py-2.5 min-w-[76px] shrink-0 text-xs font-medium border-b-2 transition-colors ${
                  isActive
                    ? "border-brand-navy text-brand-navy"
                    : "border-transparent text-gray-400 hover:text-brand-navy"
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="whitespace-nowrap">{t(key)}</span>
              </Link>
            );
          })}
        </div>
        <form action={`/auth/signout?locale=${locale}`} method="post" onSubmit={handleSignout} className="shrink-0">
          <button
            type="submit"
            disabled={signingOut}
            aria-label={t("logout")}
            className="flex flex-col items-center justify-center gap-1 px-4 py-2.5 min-w-[76px] shrink-0 text-xs font-medium border-b-2 border-transparent text-gray-400 hover:text-state-danger transition-colors disabled:opacity-50 border-l border-gray-100"
          >
            <LogOut className="w-5 h-5" />
            <span className="whitespace-nowrap">{t("logout")}</span>
          </button>
        </form>
      </div>
      {signoutError && (
        <p className="px-4 py-1.5 text-xs text-state-danger text-center">{t("logoutError")}</p>
      )}
    </nav>
  );
}

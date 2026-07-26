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
import React from "react";
import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Wrench, Home, Wallet, Gift, Settings, LogOut } from "lucide-react";

const SECTIONS = [
  { key: "servicios", href: "servicios", icon: Wrench },
  { key: "propiedades", href: "propiedades", icon: Home },
  { key: "billetera", href: "billetera", icon: Wallet },
  { key: "referidos", href: "referidos", icon: Gift },
  { key: "preferencias", href: "preferencias", icon: Settings },
] as const;

export function CuentaNav() {
  const t = useTranslations("cuenta.nav");
  const pathname = usePathname();
  const params = useParams();
  const locale = (params?.locale as string) || "en";

  // Fix (auditoría de autenticación 2026-07-25/26, item 4): antes cerraba
  // sesión directo desde el navegador con supabase.auth.signOut(), distinto
  // al patrón ya usado en /admin (form POST a /auth/signout, ver
  // src/app/[locale]/admin/layout.tsx). Se unifica al mismo endpoint server-
  // side -- limpia las cookies de sesión de forma consistente y evita tener
  // dos mecanismos de logout distintos en el mismo proyecto. Se usa un
  // <form> normal (no fetch) para que el POST + redirect final de esa Route
  // Handler funcione igual que en /admin.
  return (
    <nav
      aria-label={t("ariaLabel")}
      className="sticky top-0 z-20 bg-white border-b border-gray-200 shadow-elevation-1"
    >
      <div className="max-w-lg mx-auto flex items-stretch overflow-x-auto">
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
        <form action={`/auth/signout?locale=${locale}`} method="post" className="ml-auto">
          <button
            type="submit"
            aria-label={t("logout")}
            className="flex flex-col items-center justify-center gap-1 px-4 py-2.5 min-w-[76px] shrink-0 text-xs font-medium border-b-2 border-transparent text-gray-400 hover:text-state-danger transition-colors"
          >
            <LogOut className="w-5 h-5" />
            <span className="whitespace-nowrap">{t("logout")}</span>
          </button>
        </form>
      </div>
    </nav>
  );
}

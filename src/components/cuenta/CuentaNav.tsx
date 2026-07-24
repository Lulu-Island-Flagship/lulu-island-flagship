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
// Logout: reusa el MISMO mecanismo que empleado/page.tsx handleLogout()
// (supabase.auth.signOut() + router.push a la pantalla de login del área),
// no se inventa un flujo nuevo. La diferencia es el destino: en /cuenta no
// hay "Portal" propio -- el login de cliente es el AuthModal montado por
// cuenta/layout.tsx sobre la propia ruta actual, así que basta con navegar
// a la raíz de /cuenta (o quedarse en la página actual) tras el signOut;
// el layout detecta la sesión perdida vía onAuthStateChange y vuelve a
// mostrar el AuthModal automáticamente -- sin necesitar un router.push
// explícito a otra URL.
import React from "react";
import Link from "next/link";
import { usePathname, useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Wrench, Home, Wallet, Gift, Settings, LogOut } from "lucide-react";
import { supabase } from "@/lib/supabase";

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
  const router = useRouter();
  const locale = (params?.locale as string) || "en";

  const handleLogout = async () => {
    await supabase.auth.signOut();
    // cuenta/layout.tsx escucha onAuthStateChange y vuelve a mostrar el
    // AuthModal automáticamente al perder la sesión -- no hace falta
    // redirigir a otra ruta, solo asegurarnos de estar en la raíz de
    // /cuenta para un login limpio (evita quedarse en, p.ej., un formulario
    // de edición a medio llenar tras cerrar sesión).
    router.push(`/${locale}/cuenta`);
  };

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
        <button
          type="button"
          onClick={handleLogout}
          aria-label={t("logout")}
          className="flex flex-col items-center justify-center gap-1 px-4 py-2.5 min-w-[76px] shrink-0 text-xs font-medium border-b-2 border-transparent text-gray-400 hover:text-state-danger transition-colors ml-auto"
        >
          <LogOut className="w-5 h-5" />
          <span className="whitespace-nowrap">{t("logout")}</span>
        </button>
      </div>
    </nav>
  );
}

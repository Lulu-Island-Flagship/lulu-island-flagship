"use client";

import React from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { useTranslations } from "next-intl";

interface EmpleadoBackHeaderProps {
  title: string;
  /** Dónde vuelve el botón "Atrás" -- normalmente `/${locale}/employee` (dashboard). */
  backHref: string;
  icon?: React.ElementType;
}

/**
 * Auditoría UX/seguridad 2026-07-25 (#11): checkin/page.tsx, ritual/page.tsx
 * y servicio/[orderId]/preparacion/page.tsx no tenían NINGUNA forma de
 * volver al dashboard -- ni botón, ni link, ni header. Un empleado que
 * entraba a cualquiera de esas 3 pantallas quedaba varado ahí (solo el
 * botón "atrás" nativo del navegador servía, si es que lo tenía visible).
 *
 * Este header con botón "Atrás" al dashboard del empleado (backHref) se
 * extrae el patrón ya repetido para reusarlo también en las 3 páginas que
 * lo tenían faltante.
 */
export function EmpleadoBackHeader({ title, backHref, icon: Icon }: EmpleadoBackHeaderProps) {
  const t = useTranslations("common");
  return (
    <header className="bg-brand-navy text-white">
      <div className="max-w-lg mx-auto px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="w-5 h-5 text-brand-gold" />}
          <span className="font-semibold text-sm">{title}</span>
        </div>
        {/* v8.3 ROUND 4 fix (#8): antes era <a href>, que forzaba una recarga
            completa de página (perdiendo el estado del SPA/PWA) en cada
            "Back". Link de Next.js navega client-side. */}
        <Link
          href={backHref}
          className="flex items-center gap-1 text-sm text-gray-300 hover:text-white transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          {t("back")}
        </Link>
      </div>
    </header>
  );
}

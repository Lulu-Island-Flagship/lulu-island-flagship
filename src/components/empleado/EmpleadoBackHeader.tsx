"use client";

import React from "react";
import { ChevronLeft } from "lucide-react";

interface EmpleadoBackHeaderProps {
  title: string;
  /** Dónde vuelve el botón "Atrás" -- normalmente `/${locale}/empleado` (dashboard). */
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
 * Este header es intencionalmente el mismo patrón visual que ya usan
 * score/page.tsx y votacion/page.tsx (bg-brand-navy, título + "Back" a la
 * derecha) -- no se inventa un componente nuevo con estilo propio, se
 * extrae el patrón ya repetido para reusarlo también en las 3 páginas que
 * lo tenían faltante.
 */
export function EmpleadoBackHeader({ title, backHref, icon: Icon }: EmpleadoBackHeaderProps) {
  return (
    <header className="bg-brand-navy text-white">
      <div className="max-w-lg mx-auto px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="w-5 h-5 text-brand-gold" />}
          <span className="font-semibold text-sm">{title}</span>
        </div>
        <a
          href={backHref}
          className="flex items-center gap-1 text-sm text-gray-300 hover:text-white transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          Back
        </a>
      </div>
    </header>
  );
}

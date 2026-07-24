"use client";

// Muestra "Admin > [Grupo] > [Página actual]" en las ~70 rutas de /admin.
// Reusa buildGroups() de AdminNav.tsx (misma estructura de label+href+
// resource) en vez de mantener una segunda lista de nombres de página --
// si mañana se agrega/renombra un link en el nav, el breadcrumb queda
// sincronizado automáticamente sin tocar este archivo.
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { buildGroups, type NavLink } from "@/components/admin/AdminNav";

/** Convierte un slug de ruta ("dr-drill", "warranty-claims") en un label
 * legible de respaldo, para páginas que no están en buildGroups() (ej. el
 * dashboard raíz, o alguna página huérfana sin link en el nav todavía). */
function humanizeSlug(slug: string): string {
  return slug
    .split("-")
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export default function AdminBreadcrumbs({ adminPath }: { adminPath: string }) {
  const pathname = usePathname() || adminPath;

  // Ruta exacta del dashboard raíz de admin -- no hay grupo ni página que
  // mostrar más allá de "Admin".
  if (pathname === adminPath || pathname === `${adminPath}/`) {
    return null;
  }

  const groups = buildGroups(adminPath);

  let currentGroupLabel: string | null = null;
  let currentLink: NavLink | null = null;

  for (const group of groups) {
    // Match exacto primero; si no hay, cae al link cuyo href es prefijo de
    // la ruta actual (ej. /admin/pricing-rules/sandbox bajo "Pricing Rules").
    const exact = group.links.find((link) => link.href === pathname);
    if (exact) {
      currentGroupLabel = group.label;
      currentLink = exact;
      break;
    }
    const prefixMatch = group.links.find((link) => pathname.startsWith(`${link.href}/`));
    if (prefixMatch) {
      currentGroupLabel = group.label;
      currentLink = prefixMatch;
      break;
    }
  }

  // Fallback para páginas sin entrada en el nav (ej. huérfanas por rol, o
  // aún no enlazadas): usa el primer segmento después de /admin como label.
  const fallbackSlug = pathname.slice(adminPath.length).split("/").filter(Boolean)[0] || "";
  const currentPageLabel = currentLink?.label ?? (fallbackSlug ? humanizeSlug(fallbackSlug) : "");

  return (
    <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1.5 text-sm text-gray-500">
      <a href={adminPath} className="hover:text-brand-navy hover:underline">
        Admin
      </a>
      {currentGroupLabel && (
        <>
          <ChevronRight className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>{currentGroupLabel}</span>
        </>
      )}
      {currentPageLabel && (
        <>
          <ChevronRight className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="text-brand-ink font-medium" aria-current="page">
            {currentPageLabel}
          </span>
        </>
      )}
    </nav>
  );
}

// Fix (auditoría transversal 2026-07-25, item 6): no existía ningún
// loading.tsx bajo src/app/[locale]/ -- Next.js no mostraba ningún
// indicador de carga durante la navegación/streaming entre rutas del
// locale (pantalla en blanco hasta que el Server Component resuelve).
//
// Fix (auditoría UX 2026-07-25, item 11): "Loading"/"Loading…" quedaron
// hardcodeados en inglés -- un cliente navegando en fr/zh veía texto en
// inglés en este spinner. A diferencia de page.tsx/layout.tsx, loading.js NO
// recibe `params` de forma soportada en Next.js App Router (fuera del
// contrato documentado de props de este archivo especial). En cambio,
// getTranslations() de next-intl SIN locale explícito ya resuelve el locale
// actual vía `requestLocale` (ver src/i18n/request.ts), que next-intl
// propaga por request independientemente de qué props reciba cada Server
// Component -- el mismo mecanismo que usan generateMetadata/layout, solo que
// aquí se deja que se auto-detecte en vez de pasarlo a mano.
import { getTranslations } from "next-intl/server";

export default async function Loading() {
  const t = await getTranslations({ namespace: "common" });
  return (
    <div
      className="min-h-screen bg-white flex items-center justify-center"
      role="status"
      aria-label={t("loading")}
    >
      <div className="w-10 h-10 rounded-full border-4 border-brand-ice border-t-brand-navy animate-spin" />
      <span className="sr-only">{t("loadingEllipsis")}</span>
    </div>
  );
}

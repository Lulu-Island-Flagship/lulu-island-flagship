"use client";

// Fix (auditoría transversal 2026-07-25, item 6): no existía ningún
// error.tsx bajo src/app/[locale]/ -- cualquier error en render/render-time
// data fetching de un Server o Client Component bajo un locale caía en la
// pantalla de error genérica de Next.js (o la del navegador en dev), sin
// idioma ni marca. Next.js exige que error.tsx sea un Client Component (usa
// hooks internamente para el boundary) -- ver
// https://nextjs.org/docs/app/api-reference/file-conventions/error. Al estar
// anidado bajo src/app/[locale]/layout.tsx, sigue dentro de
// NextIntlClientProvider y puede usar useTranslations con normalidad, a
// diferencia de src/app/global-error.tsx (raíz, fuera del provider).
import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertTriangle, RotateCw, Ship } from "lucide-react";

export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errorPages.error");
  const pathname = usePathname();
  const pathLocale = pathname?.match(/^\/(en|zh|fr)(\/|$)/);
  const locale = pathLocale ? pathLocale[1] : "en";

  useEffect(() => {
    // No hay proveedor de monitoreo de errores (Sentry/similar) conectado en
    // este repo (se verificó: no aparece en package.json ni en next.config.mjs)
    // -- console.error es el único registro real disponible hoy. No se inventa
    // una integración que no existe.
    console.error("[locale error boundary]", error);
  }, [error]);

  return (
    <main className="min-h-screen bg-brand-ice flex items-center justify-center px-4 py-16">
      <div className="max-w-md w-full text-center">
        <div className="w-16 h-16 mx-auto mb-6 bg-white rounded-full flex items-center justify-center shadow-elevation-2">
          <AlertTriangle className="w-8 h-8 text-state-danger" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold text-brand-ink mb-3">{t("title")}</h1>
        <p className="text-gray-600 mb-8 leading-relaxed">{t("description")}</p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={() => reset()}
            className="inline-flex items-center justify-center gap-2 bg-brand-navy text-white px-6 py-3 rounded-lg font-medium hover:bg-brand-navy-light transition-colors"
          >
            <RotateCw className="w-4 h-4" />
            {t("retry")}
          </button>
          <Link
            href={`/${locale}`}
            className="inline-flex items-center justify-center gap-2 bg-white text-brand-navy border border-brand-navy/20 px-6 py-3 rounded-lg font-medium hover:bg-brand-ice transition-colors"
          >
            <Ship className="w-4 h-4" />
            {t("cta")}
          </Link>
        </div>
      </div>
    </main>
  );
}

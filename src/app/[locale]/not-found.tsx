"use client";

// Fix (auditoría transversal 2026-07-25, item 6): no existía ningún
// not-found.tsx bajo src/app/[locale]/ -- una ruta inexistente dentro de un
// locale válido (ej. /en/algo-que-no-existe) caía en la página 404 genérica
// sin estilo de Next.js, sin idioma ni marca. Este archivo se renderiza
// anidado dentro de src/app/[locale]/layout.tsx (que ya montó
// NextIntlClientProvider), así que puede usar useTranslations normalmente --
// a diferencia de src/app/global-error.tsx en la raíz, que corre FUERA de
// ese provider.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Ship, Compass } from "lucide-react";

export default function NotFound() {
  const t = useTranslations("errorPages.notFound");
  const pathname = usePathname();
  const pathLocale = pathname?.match(/^\/(en|zh|fr)(\/|$)/);
  const locale = pathLocale ? pathLocale[1] : "en";

  return (
    <main className="min-h-screen bg-brand-ice flex items-center justify-center px-4 py-16">
      <div className="max-w-md w-full text-center">
        <div className="w-16 h-16 mx-auto mb-6 bg-white rounded-full flex items-center justify-center shadow-elevation-2">
          <Compass className="w-8 h-8 text-brand-navy" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold text-brand-ink mb-3">{t("title")}</h1>
        <p className="text-gray-600 mb-8 leading-relaxed">{t("description")}</p>
        <Link
          href={`/${locale}`}
          className="inline-flex items-center gap-2 bg-brand-navy text-white px-6 py-3 rounded-lg font-medium hover:bg-brand-navy-light transition-colors"
        >
          <Ship className="w-4 h-4" />
          {t("cta")}
        </Link>
      </div>
    </main>
  );
}

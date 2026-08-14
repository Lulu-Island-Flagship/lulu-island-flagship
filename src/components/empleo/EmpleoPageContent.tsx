"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { Ship, ChevronLeft } from "lucide-react";
import { JobApplicationForm } from "./JobApplicationForm";

// Mismo patrón arquitectónico que src/components/legal/LegalPageLayout.tsx
// y src/components/cotizador/*: componente cliente separado montado desde
// un Server Component delgado (src/app/[locale]/empleo/page.tsx), porque
// useTranslations/usePathname requieren "use client".
export function EmpleoPageContent() {
  const t = useTranslations("empleo");
  const pathname = usePathname();
  const pathLocale = pathname.match(/^\/(en|zh|fr)(\/|$)/);
  const locale = pathLocale ? pathLocale[1] : "en";

  return (
    <main className="min-h-screen bg-brand-ice">
      <header className="bg-brand-navy text-white">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href={`/${locale}`} className="flex items-center gap-2">
            <Ship className="w-6 h-6 text-brand-gold-dark" />
            <span className="font-semibold">Lulu Island Flagship</span>
          </Link>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-10">
        <Link
          href={`/${locale}`}
          className="inline-flex items-center gap-1 text-sm text-brand-navy hover:text-brand-wave-blue transition-colors mb-6"
        >
          <ChevronLeft className="w-4 h-4" />
          {t("backHome")}
        </Link>

        <h1 className="text-2xl sm:text-3xl font-bold text-brand-ink mb-2">{t("title")}</h1>
        <p className="text-gray-600 mb-8 leading-relaxed">{t("intro")}</p>

        <JobApplicationForm />
      </div>
    </main>
  );
}

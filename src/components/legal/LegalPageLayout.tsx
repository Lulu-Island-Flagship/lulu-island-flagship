"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronLeft, Ship, Info } from "lucide-react";

interface LegalSection {
  heading: string;
  body: string;
}

interface LegalPageLayoutProps {
  /** Namespace under "legal", e.g. "terms" | "privacy" | "cancellation" */
  namespace: "terms" | "privacy" | "cancellation";
}

/**
 * Layout compartido para las 3 páginas legales públicas (/terminos,
 * /privacidad, /cancelacion). Contenido 100% data-driven desde
 * messages/{locale}.json bajo "legal.{namespace}" -- así las 3 páginas se
 * mantienen internacionalizadas sin duplicar JSX por idioma.
 */
export function LegalPageLayout({ namespace }: LegalPageLayoutProps) {
  const t = useTranslations("legal");
  const tPage = useTranslations(`legal.${namespace}`);

  const locale = typeof window !== "undefined" ? window.location.pathname.split("/")[1] : "en";
  const safeLocale = ["en", "zh", "fr"].includes(locale) ? locale : "en";

  const sections = tPage.raw("sections") as LegalSection[];

  return (
    <main className="min-h-screen bg-brand-ice">
      <header className="bg-brand-navy text-white">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href={`/${safeLocale}`} className="flex items-center gap-2">
            <Ship className="w-6 h-6 text-brand-gold-dark" />
            <span className="font-semibold">Lulu Island Flagship</span>
          </Link>
          <nav className="hidden sm:flex items-center gap-4 text-sm text-gray-300">
            <Link href={`/${safeLocale}/terms`} className="hover:text-white transition-colors">
              {t("nav.terms")}
            </Link>
            <Link href={`/${safeLocale}/privacy`} className="hover:text-white transition-colors">
              {t("nav.privacy")}
            </Link>
            <Link href={`/${safeLocale}/cancellation`} className="hover:text-white transition-colors">
              {t("nav.cancellation")}
            </Link>
          </nav>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-10">
        <Link
          href={`/${safeLocale}`}
          className="inline-flex items-center gap-1 text-sm text-brand-navy hover:text-brand-wave-blue transition-colors mb-6"
        >
          <ChevronLeft className="w-4 h-4" />
          {t("backHome")}
        </Link>

        <div className="bg-white rounded-lg shadow-elevation-1 p-6 sm:p-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-brand-ink mb-1">{tPage("title")}</h1>
          <p className="text-xs text-gray-400 mb-6">{t("lastUpdated")}</p>
          <p className="text-gray-600 mb-8 leading-relaxed">{tPage("intro")}</p>

          {namespace === "cancellation" && (
            <div className="flex items-start gap-3 bg-brand-ice border border-brand-navy/10 rounded-lg p-4 mb-8">
              <Info className="w-5 h-5 text-brand-navy flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-brand-ink mb-2">{tPage("howToCancel")}</p>
                <Link
                  href={`/${safeLocale}/account/services`}
                  className="text-sm font-medium text-brand-navy hover:text-brand-wave-blue transition-colors underline"
                >
                  {tPage("howToCancelCta")}
                </Link>
              </div>
            </div>
          )}

          <div className="space-y-6">
            {sections.map((section, i) => (
              <section key={i}>
                <h2 className="text-base font-semibold text-brand-ink mb-2">{section.heading}</h2>
                <p className="text-sm text-gray-600 leading-relaxed">{section.body}</p>
              </section>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}

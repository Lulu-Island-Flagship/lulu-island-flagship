"use client";

import React, { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Globe } from "lucide-react";

const LANG_KEY = "lulu_language";
const LOCALES = [
  { code: "en", label: "EN" },
  { code: "zh", label: "中文" },
  { code: "fr", label: "FR" },
];

interface LanguageSelectorProps {
  variant?: "default" | "select";
}

export function LanguageSelector({ variant = "default" }: LanguageSelectorProps) {
  const router = useRouter();
  const pathname = usePathname();
  const pathLocale = pathname.match(/^\/(en|zh|fr)(\/|$)/);
  const [currentLocale, setCurrentLocale] = useState(() => {
    if (pathLocale) {
      return pathLocale[1];
    }
    try {
      const saved = localStorage.getItem(LANG_KEY);
      if (saved && LOCALES.some((l) => l.code === saved)) {
        return saved;
      }
    } catch {
      // ignore
    }
    return "en";
  });

  useEffect(() => {
    if (pathLocale && pathLocale[1] !== currentLocale) {
      setCurrentLocale(pathLocale[1]);
    }
  }, [pathname, currentLocale, pathLocale]);

  const switchLanguage = (locale: string) => {
    setCurrentLocale(locale);
    try {
      localStorage.setItem(LANG_KEY, locale);
    } catch {
      // ignore
    }

    const pathWithoutLocale = pathname.replace(/^\/(en|zh|fr)(\/|$)/, "/");
    const newPath = `/${locale}${pathWithoutLocale}`;
    router.push(newPath);
  };

  if (variant === "select") {
    return (
      <div className="relative flex items-center bg-brand-ice/90 border border-brand-navy/10 rounded-lg px-2 py-1 gap-1 min-h-[36px]">
        <Globe className="w-3.5 h-3.5 text-brand-navy shrink-0" />
        <select
          value={currentLocale}
          onChange={(e) => switchLanguage(e.target.value)}
          aria-label="Language selection"
          className="bg-transparent text-xs font-semibold text-brand-navy outline-none cursor-pointer pr-1 appearance-none"
        >
          {LOCALES.map((loc) => (
            <option key={loc.code} value={loc.code}>
              {loc.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 min-h-[36px]">
      <Globe className="w-4 h-4 text-brand-navy mr-1 shrink-0" />
      {LOCALES.map((locale, index) => (
        <React.Fragment key={locale.code}>
          <button
            onClick={() => switchLanguage(locale.code)}
            aria-label={`${locale.label} (${locale.code})`}
            aria-pressed={currentLocale === locale.code}
            lang={locale.code}
            className={`text-sm font-medium transition-colors px-1 py-1 rounded touch-manipulation ${
              currentLocale === locale.code
                ? "text-brand-navy font-bold underline underline-offset-4"
                : "text-gray-500 hover:text-brand-navy"
            }`}
          >
            {locale.label}
          </button>
          {index < LOCALES.length - 1 && (
            <span className="text-gray-400 mx-0.5">|</span>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

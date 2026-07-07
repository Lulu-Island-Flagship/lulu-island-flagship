"use client";

import React, { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Globe } from "lucide-react";

const LANG_KEY = "lulu_language";
const LOCALES = [
  { code: "en", label: "EN" },
  { code: "zh", label: "中文" },
  { code: "fr", label: "FR" },
];

export function LanguageSelector() {
  const router = useRouter();
  const pathname = usePathname();
  // Read locale from pathname on initial render, fallback to localStorage
  const pathLocale = pathname.match(/^\/(en|zh|fr)(\/|$)/);
  const [currentLocale, setCurrentLocale] = useState(() => {
    try {
      const saved = localStorage.getItem(LANG_KEY);
      if (saved && LOCALES.some((l) => l.code === saved)) {
        return saved;
      }
    } catch {
      // ignore
    }
    return pathLocale ? pathLocale[1] : "en";
  });

  const switchLanguage = (locale: string) => {
    setCurrentLocale(locale);
    try {
      localStorage.setItem(LANG_KEY, locale);
    } catch {
      // ignore
    }

    // Navigate to same path with new locale prefix
    // Remove current locale prefix if present
    const pathWithoutLocale = pathname.replace(/^\/(en|zh|fr)(\/|$)/, "/");
    const newPath = `/${locale}${pathWithoutLocale}`;
    router.push(newPath);
  };

  return (
    <div className="flex items-center gap-1">
      <Globe className="w-4 h-4 text-brand-gold mr-1" />
      {LOCALES.map((locale, index) => (
        <React.Fragment key={locale.code}>
          <button
            onClick={() => switchLanguage(locale.code)}
            className={`text-sm font-medium transition-colors ${
              currentLocale === locale.code
                ? "text-brand-gold"
                : "text-gray-300 hover:text-white"
            }`}
          >
            {locale.label}
          </button>
          {index < LOCALES.length - 1 && (
            <span className="text-gray-500 mx-1">|</span>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

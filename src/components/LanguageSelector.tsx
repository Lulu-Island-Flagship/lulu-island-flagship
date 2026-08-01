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

export function LanguageSelector() {
  const router = useRouter();
  const pathname = usePathname();
  // Fix (auditoría UX/seguridad 2026-07-25, bug #2b): la URL es la fuente de
  // verdad de qué idioma se está mostrando AHORA MISMO. Antes se leía
  // localStorage primero, así que un idioma guardado de una visita anterior
  // podía marcar como activo un locale distinto al que el usuario en
  // realidad está viendo (ej. link compartido en /en/... con 'fr' guardado).
  // localStorage solo se usa como fallback defensivo si la ruta actual no
  // trae prefijo de locale (no debería pasar dado el ruteo actual).
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

  // Fix (auditoría 2026-07-31, item 15): `useState(() => ...)` solo corre su
  // inicializador en el primer render -- si el locale de la ruta cambia
  // DESPUÉS del montaje sin pasar por `switchLanguage` (ej. el usuario
  // navega manualmente a otra URL con distinto prefijo de locale, o usa
  // atrás/adelante del navegador entre rutas de distinto idioma), este
  // componente seguía marcando como "activo" el idioma con el que se montó
  // la primera vez, desincronizado de la URL real. `usePathname()` sí es
  // reactivo a cambios de ruta; se resincroniza `currentLocale` cada vez que
  // cambia, siempre que la ruta traiga un prefijo de locale reconocido.
  useEffect(() => {
    if (pathLocale && pathLocale[1] !== currentLocale) {
      setCurrentLocale(pathLocale[1]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

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
      <Globe className="w-4 h-4 text-brand-navy mr-1" />
      {LOCALES.map((locale, index) => (
        <React.Fragment key={locale.code}>
          <button
            onClick={() => switchLanguage(locale.code)}
            aria-label={`${locale.label} (${locale.code})`}
            aria-pressed={currentLocale === locale.code}
            lang={locale.code}
            className={`text-sm font-medium transition-colors ${
              currentLocale === locale.code
                ? "text-brand-navy font-bold underline underline-offset-4"
                : "text-gray-500 hover:text-brand-navy"
            }`}
          >
            {locale.label}
          </button>
          {index < LOCALES.length - 1 && (
            <span className="text-gray-400 mx-1">|</span>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Languages, Check } from "lucide-react";
import { SUPPORTED_LANGUAGES } from "@/lib/languages";

interface LanguagePreferenceProps {
  /** Ordenado por prioridad (el primero es el idioma preferido principal). */
  value: string[];
  onChange: (languages: string[]) => void;
}

/**
 * v8.3 M0-F0.4 (B.2.13): captura el/los idioma(s) de la cuenta del cliente.
 * Sin esto, client_profiles.preferred_languages siempre quedaba en el
 * default ['en'] y el match de idioma del despacho nunca tenía dato real
 * que consultar. El orden de selección define la prioridad: tocar un
 * idioma ya seleccionado lo quita; tocar uno nuevo lo agrega al final.
 */
export function LanguagePreference({ value, onChange }: LanguagePreferenceProps) {
  const t = useTranslations("cotizador.languagePreference");
  const toggle = (code: string) => {
    if (value.includes(code)) {
      const next = value.filter((c) => c !== code);
      // Nunca dejar la lista vacía — al menos un idioma debe quedar seleccionado.
      onChange(next.length > 0 ? next : ["en"]);
    } else {
      onChange([...value, code]);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Languages className="w-4 h-4 text-brand-wave-blue" />
        <h3 className="font-semibold text-brand-ink text-sm">{t("title")}</h3>
      </div>
      <p className="text-xs text-gray-500">
        {t("description")}
      </p>
      <div className="flex flex-wrap gap-2">
        {SUPPORTED_LANGUAGES.map((lang) => {
          const priority = value.indexOf(lang.code);
          const selected = priority !== -1;
          return (
            <button
              key={lang.code}
              type="button"
              onClick={() => toggle(lang.code)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border-2 text-sm font-medium transition-all ${
                selected
                  ? "border-brand-wave-blue bg-brand-wave-blue/10 text-brand-navy"
                  : "border-gray-200 text-gray-600 hover:border-brand-wave-blue"
              }`}
            >
              {selected && (
                <span className="flex items-center justify-center w-4 h-4 rounded-full bg-brand-wave-blue text-white text-[10px]">
                  {priority + 1}
                </span>
              )}
              {lang.label}
              {selected && <Check className="w-3.5 h-3.5 text-state-success" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

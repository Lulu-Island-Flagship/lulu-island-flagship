"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Minus, Plus, Ruler } from "lucide-react";

interface StepDimensionsProps {
  bedrooms: number;
  bathrooms: number;
  squareFeet: number;
  onChange: (vals: { bedrooms: number; bathrooms: number; squareFeet: number }) => void;
}

export function StepDimensions({ bedrooms, bathrooms, squareFeet, onChange }: StepDimensionsProps) {
  const t = useTranslations("cotizador.dimensions");

  const adjust = (key: "bedrooms" | "bathrooms", delta: number) => {
    const current = key === "bedrooms" ? bedrooms : bathrooms;
    const next = Math.max(0, current + delta);
    onChange({ bedrooms, bathrooms, squareFeet, [key]: next });
  };

  return (
    <div className="space-y-8">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-brand-ink mb-2">{t("title")}</h2>
        <p className="text-gray-600">{t("subtitle")}</p>
      </div>

      {/* Bedrooms */}
      <div className="bg-brand-ice rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-brand-ink">{t("bedroomsTitle")}</h3>
            <p className="text-sm text-gray-500">{t("bedroomsSubtitle")}</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              aria-label={t("decreaseBedroomsAriaLabel")}
              onClick={() => adjust("bedrooms", -1)}
              className="w-10 h-10 rounded-full bg-white border border-gray-200 flex items-center justify-center hover:border-brand-wave-blue transition-colors"
            >
              <Minus className="w-4 h-4" />
            </button>
            <span className="w-8 text-center font-semibold text-lg">{bedrooms}</span>
            <button
              aria-label={t("increaseBedroomsAriaLabel")}
              onClick={() => adjust("bedrooms", 1)}
              className="w-10 h-10 rounded-full bg-white border border-gray-200 flex items-center justify-center hover:border-brand-wave-blue transition-colors"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Bathrooms */}
      <div className="bg-brand-ice rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-brand-ink">{t("bathroomsTitle")}</h3>
            <p className="text-sm text-gray-500">{t("bathroomsSubtitle")}</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              aria-label={t("decreaseBathroomsAriaLabel")}
              onClick={() => adjust("bathrooms", -1)}
              className="w-10 h-10 rounded-full bg-white border border-gray-200 flex items-center justify-center hover:border-brand-wave-blue transition-colors"
            >
              <Minus className="w-4 h-4" />
            </button>
            <span className="w-8 text-center font-semibold text-lg">{bathrooms}</span>
            <button
              aria-label={t("increaseBathroomsAriaLabel")}
              onClick={() => adjust("bathrooms", 1)}
              className="w-10 h-10 rounded-full bg-white border border-gray-200 flex items-center justify-center hover:border-brand-wave-blue transition-colors"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Square Feet */}
      <div className="bg-brand-ice rounded-lg p-6">
        <div className="flex items-center gap-3 mb-4">
          <Ruler className="w-5 h-5 text-brand-wave-blue" />
          <div>
            <h3 className="font-semibold text-brand-ink">{t("squareFeetTitle")}</h3>
            <p className="text-sm text-gray-500">{t("squareFeetSubtitle")}</p>
          </div>
        </div>
        <input
          aria-label="Metros cuadrados aproximados de la propiedad"
          type="range"
          min="300"
          max="10000"
          step="100"
          value={squareFeet}
          onChange={(e) => onChange({ bedrooms, bathrooms, squareFeet: parseInt(e.target.value) })}
          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-brand-gold"
        />
        <div className="flex justify-between mt-2 text-sm text-gray-500">
          <span>300 ft²</span>
          <span className="font-semibold text-brand-ink text-lg">{squareFeet.toLocaleString()} ft²</span>
          <span>10,000 ft²</span>
        </div>
        {/* Fix (2026-07-24): se quitó el botón manual "Suggest from BC
            Assessment" que vivía aquí -- llamaba a /api/bc-assessment
            dependiendo de una `address` que en este punto del wizard
            (paso "dimensions") todavía no existe (el paso "address" viene
            después), así que siempre fallaba con "Enter an address first".
            Era además un duplicado exacto de la sugerencia de BC Assessment
            que YA funciona correctamente en StepAddress.tsx: se dispara
            sola mientras el cliente escribe su dirección (debounced,
            /api/quote/bc-assessment) y ofrece Correcto/Diferente ahí mismo.
            No hace falta una segunda versión rota de la misma función. */}
      </div>
    </div>
  );
}

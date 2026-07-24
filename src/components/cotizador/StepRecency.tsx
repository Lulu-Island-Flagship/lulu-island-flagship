"use client";

import React from "react";
import { useTranslations } from "next-intl";

interface StepRecencyProps {
  days: number;
  onChange: (value: number) => void;
}

// NUNCA mostrar multiplicadores internos al cliente
const PRESETS = [
  { key: "lessThan30", days: 14, rangeMax: 29 },
  { key: "oneToTwoMonths", days: 45, rangeMax: 59 },
  { key: "twoToThreeMonths", days: 75, rangeMax: 89 },
  { key: "moreThanThree", days: 120, rangeMax: 180 },
] as const;

export function StepRecency({ days, onChange }: StepRecencyProps) {
  const t = useTranslations("cotizador.recency");
  const selectedPreset = PRESETS.find((p) => days <= p.rangeMax) ?? PRESETS[3];

  return (
    <div className="space-y-8">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-brand-ink mb-2">
          {t("title")}
        </h2>
        <p className="text-gray-600">
          {t("subtitle")}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {PRESETS.map((preset) => {
          const isSelected = selectedPreset.key === preset.key;
          return (
            <button
              key={preset.key}
              onClick={() => onChange(preset.days)}
              className={`p-4 rounded-lg border-2 text-left transition-all ${
                isSelected
                  ? "border-brand-gold bg-brand-gold/10"
                  : "border-gray-200 hover:border-brand-wave-blue"
              }`}
            >
              <div className="flex flex-col">
                <span className="font-medium">{t(`presets.${preset.key}.label`)}</span>
                <span className="text-sm text-gray-500 mt-1">{t(`presets.${preset.key}.hint`)}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

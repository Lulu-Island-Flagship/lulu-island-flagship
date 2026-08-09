"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Cat, Dog, PawPrint, Users } from "lucide-react";
import { PET_TYPES, PetType } from "@/lib/pricing";

interface StepOrganicProps {
  petsCount: number;
  petsType: string;
  residents: number;
  onChange: (vals: { petsCount: number; petsType: string; residents: number }) => void;
}

const PET_TYPE_ICONS: Record<PetType, React.ReactNode> = {
  none: <PawPrint className="w-5 h-5" />,
  short_hair: <Cat className="w-5 h-5" />,
  long_hair: <Dog className="w-5 h-5" />,
  multiple: <PawPrint className="w-5 h-5" />,
};

export function StepOrganic({ petsCount, petsType, residents, onChange }: StepOrganicProps) {
  const t = useTranslations("cotizador.organic");

  return (
    <div className="space-y-8">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-brand-ink mb-2">{t("title")}</h2>
        <p className="text-gray-600">{t("subtitle")}</p>
      </div>

      {/* Residents (Mandatory, placed above Pets) */}
      <div className="bg-brand-ice rounded-lg p-6">
        <h3 className="font-semibold text-brand-ink flex items-center gap-2 mb-4">
          <Users className="w-5 h-5 text-brand-wave-blue" />
          {t("residentsTitle")}
          <span className="text-state-danger font-bold text-xs" title="Required">*</span>
        </h3>
        <div className="flex items-center gap-2 flex-wrap">
          {[1, 2, 3, 4, 5, "6+"].map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={residents === (n === "6+" ? 6 : n)}
              onClick={() =>
                onChange({
                  petsCount,
                  petsType,
                  residents: n === "6+" ? 6 : (n as number),
                })
              }
              className={`w-12 h-12 rounded-full flex items-center justify-center text-sm font-medium transition-all ${
                residents === (n === "6+" ? 6 : n)
                  ? "bg-brand-navy text-white shadow-sm"
                  : "bg-white border border-gray-200 text-gray-600 hover:border-brand-wave-blue"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* Pets (Placed below Residents) */}
      <div className="bg-brand-ice rounded-lg p-6 space-y-4">
        <h3 className="font-semibold text-brand-ink flex items-center gap-2">
          <PawPrint className="w-5 h-5 text-brand-wave-blue" />
          {t("petsTitle")}
        </h3>
        <div className="grid grid-cols-2 gap-3">
          {PET_TYPES.map((type) => {
            const isSelected = petsType === type;
            return (
              <button
                key={type}
                type="button"
                aria-pressed={isSelected}
                onClick={() =>
                  onChange({
                    petsCount: type === "none" ? 0 : Math.max(1, petsCount),
                    petsType: type,
                    residents,
                  })
                }
                className={`p-4 rounded-lg border-2 text-left transition-all ${
                  isSelected
                    ? "border-brand-gold bg-brand-gold/10"
                    : "border-gray-200 hover:border-brand-wave-blue"
                }`}
              >
                <div className={`mb-2 ${isSelected ? "text-brand-gold" : "text-brand-navy"}`}>
                  {PET_TYPE_ICONS[type]}
                </div>
                <span className="text-sm font-medium">{t(`petTypes.${type}`)}</span>
              </button>
            );
          })}
        </div>

        {petsType && petsType !== "none" && (
          <div className="flex items-center gap-4 pt-2">
            <span className="text-sm text-gray-600">{t("howMany")}</span>
            <div className="flex items-center gap-2">
              {[1, 2, 3, "4+"].map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={petsCount === (n === "4+" ? 4 : n)}
                  onClick={() =>
                    onChange({
                      petsCount: n === "4+" ? 4 : (n as number),
                      petsType,
                      residents,
                    })
                  }
                  className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium transition-all ${
                    petsCount === (n === "4+" ? 4 : n)
                      ? "bg-brand-navy text-white"
                      : "bg-white border border-gray-200 text-gray-600 hover:border-brand-wave-blue"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

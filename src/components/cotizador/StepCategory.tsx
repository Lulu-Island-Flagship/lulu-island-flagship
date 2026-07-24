"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SERVICE_CATEGORIES, ServiceCategory } from "@/lib/pricing";
import { Home, Building2 } from "lucide-react";

const ICONS: Record<string, React.ReactNode> = {
  home: <Home className="w-8 h-8" />,
  commercial: <Building2 className="w-8 h-8" />,
};

interface StepCategoryProps {
  value?: ServiceCategory;
  onChange: (value: ServiceCategory) => void;
}

export function StepCategory({ value, onChange }: StepCategoryProps) {
  const t = useTranslations("cotizador.category");

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-brand-ink mb-2">
          {t("title")}
        </h2>
        <p className="text-gray-600">
          {t("subtitle")}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {SERVICE_CATEGORIES.map((cat) => {
          const isSelected = value === cat.key;
          return (
            <button
              key={cat.key}
              onClick={() => onChange(cat.key)}
              className={`p-6 rounded-lg border-2 text-left transition-all ${
                isSelected
                  ? "border-brand-gold bg-brand-gold/10"
                  : "border-gray-200 hover:border-brand-wave-blue hover:bg-brand-ice"
              }`}
            >
              <div
                className={`mb-4 ${
                  isSelected ? "text-brand-gold" : "text-brand-navy"
                }`}
              >
                {ICONS[cat.key]}
              </div>
              <h3 className="font-semibold text-brand-ink mb-1">
                {t(`items.${cat.key}.label`)}
              </h3>
              <p className="text-sm text-gray-500">{t(`items.${cat.key}.description`)}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

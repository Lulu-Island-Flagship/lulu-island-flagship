"use client";

import React, { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Home, Building2, Ruler, MapPin } from "lucide-react";
import { SERVICE_CATEGORIES, SERVICE_SUBTYPES, ACTIVE_ZONES, type ServiceCategory } from "@/lib/pricing";
import type { ServiceType } from "@/lib/pricing";

export interface QuickEstimate {
  serviceCategory: ServiceCategory;
  serviceSubtype: string;
  serviceType: ServiceType;
  squareFeet: number;
  zone: string;
}

interface StepEstimateProps {
  initial?: Partial<QuickEstimate>;
  onChange: (data: QuickEstimate) => void;
}

const MIN_SQFT = 300;
const MAX_SQFT = 10000;

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  home: <Home className="w-8 h-8" />,
  commercial: <Building2 className="w-8 h-8" />,
};

export function StepEstimate({ initial, onChange }: StepEstimateProps) {
  const t = useTranslations("cotizador");

  const defaultCategory = initial?.serviceCategory ?? "home";
  const defaultFirstSubtype = SERVICE_SUBTYPES[defaultCategory][0]?.key ?? "";

  const [category, setCategory] = useState<ServiceCategory>(defaultCategory);
  const [subtype, setSubtype] = useState(initial?.serviceSubtype ?? defaultFirstSubtype);
  const [squareFeet, setSquareFeet] = useState(initial?.squareFeet ?? 1000);
  const [zone, setZone] = useState(initial?.zone ?? "");

  const subtypes = SERVICE_SUBTYPES[category];
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Emit changes to parent — uses ref to avoid re-render loops from inline onChange
  useEffect(() => {
    if (!subtype || subtype.length === 0) return;
    const svcType = subtypes.find((s) => s.key === subtype)?.mapsTo;
    if (!svcType) return;
    onChangeRef.current({
      serviceCategory: category,
      serviceSubtype: subtype,
      serviceType: svcType,
      squareFeet,
      zone,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, subtype, squareFeet, zone]);

  function handleCategory(cat: ServiceCategory) {
    setCategory(cat);
    const first = SERVICE_SUBTYPES[cat][0]?.key ?? "";
    setSubtype(first);
  }

  return (
    <div className="space-y-8">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-brand-ink mb-2">{t("estimate.title")}</h2>
        <p className="text-gray-600">{t("estimate.subtitle")}</p>
      </div>

      {/* Category */}
      <div className="bg-brand-ice rounded-lg p-6">
        <h3 className="font-semibold text-brand-ink mb-3">{t("category.title")}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {SERVICE_CATEGORIES.map((cat) => {
            const isSelected = category === cat.key;
            return (
              <button
                key={cat.key}
                type="button"
                onClick={() => handleCategory(cat.key)}
                className={`p-4 rounded-lg border-2 text-left transition-all flex items-center gap-3 ${
                  isSelected
                    ? "border-brand-gold bg-brand-gold/10"
                    : "border-gray-200 hover:border-brand-wave-blue"
                }`}
              >
                {CATEGORY_ICONS[cat.key]}
                <div>
                  <span className="font-medium text-brand-ink block">{cat.label}</span>
                  <span className="text-xs text-gray-500">{cat.description}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Subtype */}
      <div className="bg-brand-ice rounded-lg p-6">
        <h3 className="font-semibold text-brand-ink mb-3">{t("purpose.title")}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {subtypes.map((s) => {
            const isSelected = subtype === s.key;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setSubtype(s.key)}
                className={`p-3 rounded-lg border-2 text-left transition-all ${
                  isSelected
                    ? "border-brand-gold bg-brand-gold/10"
                    : "border-gray-200 hover:border-brand-wave-blue"
                }`}
              >
                <span className="font-medium text-brand-ink block">{s.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Square Feet */}
      <div className="bg-brand-ice rounded-lg p-6">
        <div className="flex items-center gap-3 mb-4">
          <Ruler className="w-5 h-5 text-brand-wave-blue" />
          <div>
            <h3 className="font-semibold text-brand-ink">{t("dimensions.squareFeetTitle")}</h3>
            <p className="text-sm text-gray-500">{t("estimate.squareFeetHint")}</p>
          </div>
        </div>
        <input
          type="range"
          min={MIN_SQFT}
          max={MAX_SQFT}
          step={100}
          value={squareFeet}
          onChange={(e) => setSquareFeet(parseInt(e.target.value))}
          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-brand-gold"
        />
        <div className="flex justify-between mt-2 text-sm text-gray-500">
          <span>{MIN_SQFT.toLocaleString()} ft²</span>
          <span className="font-semibold text-brand-ink text-lg">{squareFeet.toLocaleString()} ft²</span>
          <span>{MAX_SQFT.toLocaleString()} ft²</span>
        </div>
      </div>

      {/* Zone */}
      <div className="bg-brand-ice rounded-lg p-6">
        <div className="flex items-center gap-3 mb-4">
          <MapPin className="w-5 h-5 text-brand-wave-blue" />
          <div>
            <h3 className="font-semibold text-brand-ink">{t("address.zoneLabel")}</h3>
            <p className="text-sm text-gray-500">{t("estimate.zoneHint")}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {ACTIVE_ZONES.map((z) => {
            const isSelected = zone === z.name;
            return (
              <button
                key={z.name}
                type="button"
                onClick={() => setZone(z.name)}
                className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                  isSelected
                    ? "border-brand-gold bg-brand-gold/10 text-brand-ink"
                    : "border-gray-200 text-gray-600 hover:border-brand-wave-blue"
                }`}
              >
                {z.name}{z.surcharge > 0 ? ` (+$${z.surcharge})` : ""}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { Minus, Plus, Ruler, Search, Check, X, AlertCircle, Loader2 } from "lucide-react";

interface StepDimensionsProps {
  bedrooms: number;
  bathrooms: number;
  squareFeet: number;
  address?: string;
  onChange: (vals: { bedrooms: number; bathrooms: number; squareFeet: number }) => void;
}

interface BcAssessmentSuggestion {
  squareFeet?: number;
  source: string;
  confidence: "high" | "medium" | "low" | "unavailable";
  message?: string;
}

export function StepDimensions({ bedrooms, bathrooms, squareFeet, address, onChange }: StepDimensionsProps) {
  const t = useTranslations("cotizador.dimensions");
  const [suggestion, setSuggestion] = useState<BcAssessmentSuggestion | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

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
              onClick={() => adjust("bedrooms", -1)}
              className="w-10 h-10 rounded-full bg-white border border-gray-200 flex items-center justify-center hover:border-brand-wave-blue transition-colors"
            >
              <Minus className="w-4 h-4" />
            </button>
            <span className="w-8 text-center font-semibold text-lg">{bedrooms}</span>
            <button
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
              onClick={() => adjust("bathrooms", -1)}
              className="w-10 h-10 rounded-full bg-white border border-gray-200 flex items-center justify-center hover:border-brand-wave-blue transition-colors"
            >
              <Minus className="w-4 h-4" />
            </button>
            <span className="w-8 text-center font-semibold text-lg">{bathrooms}</span>
            <button
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

        {/* BC Assessment suggestion */}
        <div className="mt-5 pt-5 border-t border-gray-200">
          <button
            type="button"
            onClick={async () => {
              if (!address || address.trim().length === 0) {
                setSearchError(t("bcAssessment.errorNoAddress"));
                return;
              }
              setSearching(true);
              setSearchError("");
              setSuggestion(null);
              try {
                const res = await fetch(`/api/bc-assessment?address=${encodeURIComponent(address)}`);
                const data = (await res.json()) as BcAssessmentSuggestion;
                if (!res.ok) {
                  setSearchError(t("bcAssessment.errorLookupFailed"));
                  return;
                }
                setSuggestion(data);
              } catch {
                setSearchError(t("bcAssessment.errorNetwork"));
              } finally {
                setSearching(false);
              }
            }}
            disabled={searching}
            className="inline-flex items-center gap-2 rounded-lg border border-brand-wave-blue px-4 py-2 text-sm font-medium text-brand-wave-blue hover:bg-brand-wave-blue/5 disabled:opacity-60"
          >
            {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            {t("bcAssessment.button")}
          </button>

          {searchError && (
            <div className="mt-3 flex items-start gap-2 text-sm text-red-600">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              {searchError}
            </div>
          )}

          {suggestion && (
            <div className="mt-3 rounded-lg border border-brand-gold/30 bg-brand-gold/5 p-4">
              {suggestion.confidence === "unavailable" || !suggestion.squareFeet ? (
                <div className="flex items-start gap-2 text-sm text-gray-700">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                  <div>
                    <p className="font-medium">{t("bcAssessment.noSuggestion")}</p>
                    <p className="text-gray-500">{suggestion.message || t("bcAssessment.noSuggestionFallback")}</p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="text-sm">
                    <p className="font-medium text-brand-ink">
                      {t("bcAssessment.suggested", { value: suggestion.squareFeet.toLocaleString() })}
                    </p>
                    <p className="text-xs text-gray-500">
                      {t("bcAssessment.confidence", { level: suggestion.confidence })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onChange({ bedrooms, bathrooms, squareFeet: suggestion.squareFeet || squareFeet })}
                      className="inline-flex items-center gap-1 rounded-lg bg-brand-navy px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-navy/90"
                    >
                      <Check className="w-3 h-3" />
                      {t("bcAssessment.use")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSuggestion(null)}
                      className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      <X className="w-3 h-3" />
                      {t("bcAssessment.ignore")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

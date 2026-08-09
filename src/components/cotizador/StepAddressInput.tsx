"use client";

import React, { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { MapPin, Loader2 } from "lucide-react";
import type { BcAssessmentResult } from "@/lib/bc-assessment";

interface StepAddressInputProps {
  address: string;
  onChange: (address: string) => void;
  /** BC Assessment result se emite al padre para el paso de verificación. */
  onBcResult?: (result: BcAssessmentResult) => void;
  hideHeader?: boolean;
}

export function StepAddressInput({ address, onChange, onBcResult, hideHeader = false }: StepAddressInputProps) {
  const t = useTranslations("cotizador.address");

  const [suggestions, setSuggestions] = useState<{ placeId: string; description: string }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [bcLoading, setBcLoading] = useState(false);
  const suggestionsRequestId = React.useRef(0);

  // ── BC Assessment: consulta debounced al escribir dirección ──
  useEffect(() => {
    if (!address || address.trim().length < 8) {
      return;
    }
    let cancelled = false;
    setBcLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/quote/bc-assessment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: address.trim() }),
        });
        if (cancelled) return;
        const data = await res.json();
        if (res.ok) {
          onBcResult?.(data as BcAssessmentResult);
        }
      } catch {
        // Silencioso: BC Assessment es opcional
      } finally {
        if (!cancelled) setBcLoading(false);
      }
    }, 800);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [address]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Google Places autocompletado ──
  useEffect(() => {
    if (!address || address.trim().length < 5) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    let cancelled = false;
    const requestId = ++suggestionsRequestId.current;
    setSuggestionsLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/quote/address-autocomplete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: address.trim() }),
        });
        if (!res.ok || cancelled || requestId !== suggestionsRequestId.current) return;
        const data = await res.json();
        if (data.available && Array.isArray(data.suggestions)) {
          setSuggestions(data.suggestions);
          setShowSuggestions(data.suggestions.length > 0);
        } else {
          setSuggestions([]);
          setShowSuggestions(false);
        }
      } catch {
        setSuggestions([]);
        setShowSuggestions(false);
      } finally {
        if (!cancelled && requestId === suggestionsRequestId.current) setSuggestionsLoading(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [address]);

  async function handleSelectSuggestion(placeId: string, fallbackDescription: string) {
    setShowSuggestions(false);
    setSuggestions([]);
    try {
      const res = await fetch("/api/quote/address-details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placeId }),
      });
      const data = await res.json();
      if (res.ok && data.available && data.formattedAddress) {
        onChange(data.formattedAddress);
      } else {
        onChange(fallbackDescription);
      }
    } catch {
      onChange(fallbackDescription);
    }
  }

  return (
    <div className="space-y-6">
      {!hideHeader && (
        <div className="text-center">
          <h2 className="text-2xl font-bold text-brand-ink mb-2">{t("title")}</h2>
          <p className="text-gray-600">{t("subtitle")}</p>
        </div>
      )}

      <div className="bg-brand-ice rounded-lg p-6">
        <label htmlFor="address-input" className="block font-semibold text-brand-ink mb-2 flex items-center gap-2">
          <MapPin className="w-5 h-5 text-brand-wave-blue" />
          {t("streetLabel")}
        </label>
        <div className="relative">
          <input
            id="address-input"
            type="text"
            value={address}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => setShowSuggestions(suggestions.length > 0)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            placeholder={t("streetPlaceholder")}
            autoComplete="off"
            role="combobox"
            aria-expanded={showSuggestions}
            aria-controls="address-suggestions"
            className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-brand-wave-blue focus:ring-2 focus:ring-brand-wave-blue/20 outline-none transition-all"
          />
          {showSuggestions && suggestions.length > 0 && (
            <ul
              id="address-suggestions"
              role="listbox"
              className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-md max-h-56 overflow-y-auto"
            >
              {suggestions.map((s) => (
                <li key={s.placeId} role="option" aria-selected="false">
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleSelectSuggestion(s.placeId, s.description)}
                    className="w-full text-left px-4 py-2 text-sm hover:bg-brand-ice transition-colors"
                  >
                    {s.description}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {suggestionsLoading && (
            <span className="sr-only" aria-live="polite">
              {t("addressSuggestionsLoading")}
            </span>
          )}
        </div>
        {bcLoading && (
          <div className="mt-3 flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            {t("bcLookingUp")}
          </div>
        )}
      </div>

      <p className="text-center text-xs text-gray-400">
        {t("bcDisclaimer")}
      </p>
    </div>
  );
}

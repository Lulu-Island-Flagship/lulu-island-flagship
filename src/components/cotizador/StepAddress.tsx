"use client";

import React, { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { MapPin, Home } from "lucide-react";
import { ACTIVE_ZONES } from "@/lib/pricing";
import { supabase } from "@/lib/supabase";
import type { ClientProperty } from "@/types";

interface StepAddressProps {
  address: string;
  zone: string;
  postalCode: string;
  onChange: (vals: { address: string; zone: string; postalCode: string }) => void;
  /** ft² actual del input (paso "dimensions"). Undefined si aún no se ha llenado. */
  squareFeet?: number;
  /** Aplica el valor sugerido de BC Assessment al ft² del formulario. */
  onSquareFeetConfirm?: (squareFeet: number) => void;
}

export function StepAddress({ address, zone, postalCode, onChange, squareFeet, onSquareFeetConfirm }: StepAddressProps) {
  const t = useTranslations("cotizador.address");
  const [postalError, setPostalError] = React.useState("");
  const [savedProperties, setSavedProperties] = useState<ClientProperty[]>([]);
  // Fix (auditoría UX 2026-07-30, BUG 2): el <select> de propiedades
  // guardadas tenía value="" fijo -- no reflejaba la propiedad elegida, así
  // que después de seleccionar una el control seguía mostrando el
  // placeholder en vez de la selección real del cliente.
  const [selectedPropertyId, setSelectedPropertyId] = useState("");
  const [bcSuggestion, setBcSuggestion] = useState<{ squareFeet: number; confidence: string } | null>(null);
  const [bcDismissed, setBcDismissed] = useState(false);

  // v8.3 E1.2 (D.1): sugerencia DÉBIL de BC Assessment -- nunca un hecho.
  // Se consulta una vez que hay una dirección razonable (>= 8 caracteres,
  // evita llamadas por cada tecla al empezar a escribir).
  useEffect(() => {
    setBcDismissed(false);
    if (!address || address.trim().length < 8) {
      setBcSuggestion(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        // Fix (auditoría UX/seguridad): la dirección viajaba como query
        // string en una petición GET, quedando expuesta en logs de acceso
        // (servidor, proxies, herramientas de analítica de red) igual que
        // cualquier otro parámetro de URL. Se envía por POST con body JSON
        // en su lugar -- ver /api/quote/bc-assessment/route.ts.
        const res = await fetch("/api/quote/bc-assessment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: address.trim() }),
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (data.confidence !== "unavailable" && typeof data.squareFeet === "number") {
          setBcSuggestion({ squareFeet: data.squareFeet, confidence: data.confidence });
        } else {
          setBcSuggestion(null);
        }
      } catch {
        setBcSuggestion(null);
      }
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [address]);

  // Regex para código postal canadiense: formato A1A 1A1 (con o sin espacio)
  const isValidCanadianPostal = (code: string): boolean => {
    const normalized = code.replace(/\s/g, "").toUpperCase();
    return /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTVWXYZ]\d[ABCEGHJ-NPRSTVWXYZ]\d$/.test(normalized);
  };

  const handlePostalChange = (value: string) => {
    const upper = value.toUpperCase();
    onChange({ address, zone, postalCode: upper });
    if (upper.length >= 6) {
      setPostalError(isValidCanadianPostal(upper) ? "" : t("postalInvalid"));
    } else {
      setPostalError("");
    }
  };

  useEffect(() => {
    async function loadProperties() {
      try {
        const { data: authData } = await supabase.auth.getUser();
        if (!authData.user) {
          setSavedProperties([]);
          return;
        }
        const { data: profile } = await supabase
          .from("client_profiles")
          .select("id")
          .eq("user_id", authData.user.id)
          .single();
        if (!profile) return;
        const { data: properties } = await supabase
          .from("client_properties")
          .select("*")
          .eq("client_profile_id", profile.id)
          .eq("is_active", true)
          .order("created_at", { ascending: false });
        setSavedProperties((properties || []) as ClientProperty[]);
      } catch {
        setSavedProperties([]);
      }
    }
    loadProperties();
  }, []);

  // Fix (auditoría 2026-07-31, hallazgo #8): al elegir una propiedad guardada
  // del <select>, selectedPropertyId quedaba fijo aunque el cliente después
  // editara manualmente la dirección/zona/código postal -- el <select>
  // seguía mostrando la propiedad guardada como "seleccionada" mientras los
  // campos reales ya no coincidían con ella, lo que confunde sobre cuál
  // dirección se va a usar realmente. Se resetea a "" en cuanto los campos
  // dejan de coincidir con la propiedad actualmente seleccionada.
  useEffect(() => {
    if (!selectedPropertyId) return;
    const property = savedProperties.find((p) => p.id === selectedPropertyId);
    if (!property) return;
    const stillMatches =
      property.address === address &&
      property.zone === zone &&
      (property.postalCode || "") === postalCode;
    if (!stillMatches) {
      setSelectedPropertyId("");
    }
  }, [address, zone, postalCode, selectedPropertyId, savedProperties]);

  return (
    <div className="space-y-8">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-brand-ink mb-2">{t("title")}</h2>
        <p className="text-gray-600">{t("subtitle")}</p>
      </div>

      {savedProperties.length > 0 && (
        <div className="bg-brand-ice rounded-lg p-6">
          <label htmlFor="saved-property-select" className="block font-semibold text-brand-ink mb-2 flex items-center gap-2">
            <Home className="w-5 h-5 text-brand-wave-blue" />
            {t("savedPropertyLabel")}
          </label>
          <select
            id="saved-property-select"
            value={selectedPropertyId}
            onChange={(e) => {
              const property = savedProperties.find((p) => p.id === e.target.value);
              setSelectedPropertyId(e.target.value);
              if (property) {
                onChange({
                  address: property.address,
                  zone: property.zone,
                  postalCode: property.postalCode || "",
                });
              }
            }}
            className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-brand-wave-blue focus:ring-2 focus:ring-brand-wave-blue/20 outline-none transition-all bg-white"
          >
            <option value="">{t("savedPropertyPlaceholder")}</option>
            {savedProperties.map((property) => (
              <option key={property.id} value={property.id}>
                {property.nickname ? `${property.nickname} — ` : ""}
                {property.address}
                {property.squareFeet ? ` (${property.squareFeet} ft²)` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Address */}
      <div className="bg-brand-ice rounded-lg p-6">
        <label htmlFor="street-address-input" className="block font-semibold text-brand-ink mb-2 flex items-center gap-2">
          <MapPin className="w-5 h-5 text-brand-wave-blue" />
          {t("streetLabel")}
        </label>
        <input
          id="street-address-input"
          type="text"
          value={address}
          onChange={(e) => onChange({ address: e.target.value, zone, postalCode })}
          placeholder={t("streetPlaceholder")}
          className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-brand-wave-blue focus:ring-2 focus:ring-brand-wave-blue/20 outline-none transition-all"
        />
        {bcSuggestion && !bcDismissed && bcSuggestion.squareFeet !== squareFeet && (
          <div className="mt-3 p-3 bg-brand-gold/10 border border-brand-gold/30 rounded-lg text-sm">
            <p className="text-brand-ink">
              {t("bcSuggestionText", { value: bcSuggestion.squareFeet })}
            </p>
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                onClick={() => {
                  onSquareFeetConfirm?.(bcSuggestion.squareFeet);
                  setBcDismissed(true);
                }}
                className="px-3 py-1.5 rounded-lg bg-brand-navy text-white text-xs font-medium"
              >
                {t("bcSuggestionCorrect")}
              </button>
              <button
                type="button"
                onClick={() => setBcDismissed(true)}
                className="px-3 py-1.5 rounded-lg border border-gray-300 text-xs font-medium text-gray-600"
              >
                {t("bcSuggestionDifferent")}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Zone */}
      <div className="bg-brand-ice rounded-lg p-6">
        <label className="block font-semibold text-brand-ink mb-3">{t("zoneLabel")}</label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {ACTIVE_ZONES.map((z) => {
            const isSelected = zone === z.name;
            return (
              <button
                key={z.name}
                onClick={() => onChange({ address, zone: z.name, postalCode })}
                className={`p-4 rounded-lg border-2 text-left transition-all ${
                  isSelected
                    ? "border-brand-gold bg-brand-gold/10"
                    : "border-gray-200 hover:border-brand-wave-blue"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{z.name}</span>
                  {z.surcharge > 0 && (
                    <span className="text-sm text-state-warning font-medium">
                      +${z.surcharge}
                    </span>
                  )}
                  {z.surcharge === 0 && (
                    <span className="text-sm text-state-success font-medium">{t("zoneBase")}</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Postal Code */}
      <div className="bg-brand-ice rounded-lg p-6">
        <label htmlFor="postal-code-input" className="block font-semibold text-brand-ink mb-2">{t("postalLabel")}</label>
        <input
          id="postal-code-input"
          type="text"
          value={postalCode}
          onChange={(e) => handlePostalChange(e.target.value)}
          placeholder={t("postalPlaceholder")}
          className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-brand-wave-blue focus:ring-2 focus:ring-brand-wave-blue/20 outline-none transition-all uppercase"
        />
        {postalError && (
          <p className="text-sm text-state-danger mt-2">{postalError}</p>
        )}
      </div>
    </div>
  );
}

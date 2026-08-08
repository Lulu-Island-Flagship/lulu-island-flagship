"use client";

import React, { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { MapPin, CheckCircle2 } from "lucide-react";

export interface VerifiedProperty {
  address: string;
  zone: string;
  postalCode: string;
  serviceCategory: "home" | "commercial";
  bedrooms: number;
  bathrooms: number;
  squareFeet: number;
  squareFeetDeclared: number;
}

interface StepVerifyPropertyProps {
  /** Dirección que el cliente ya escribió en el paso de estimate. */
  rawAddress: string;
  /** Valores ya confirmados en pasos anteriores (estimate, organic, recency). */
  initial?: Partial<VerifiedProperty>;
  onChange: (data: VerifiedProperty) => void;
}

export function StepVerifyProperty({ rawAddress, initial, onChange }: StepVerifyPropertyProps) {
  const t = useTranslations("cotizador.verify");

  const [address, setAddress] = useState(initial?.address ?? rawAddress ?? "");
  const [confirmed, setConfirmed] = useState(false);

  // Emitir al padre en cada cambio de dirección
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    onChangeRef.current({
      address,
      zone: initial?.zone ?? "",
      postalCode: initial?.postalCode ?? "",
      serviceCategory: (initial?.serviceCategory as "home" | "commercial") ?? "home",
      bedrooms: initial?.bedrooms ?? 2,
      bathrooms: initial?.bathrooms ?? 1,
      squareFeet: initial?.squareFeet ?? 1000,
      squareFeetDeclared: initial?.squareFeetDeclared ?? (initial?.squareFeet ?? 1000),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-brand-ink mb-2">{t("title")}</h2>
        <p className="text-gray-600">{t("subtitleManual")}</p>
      </div>

      {/* Dirección */}
      <div className="bg-brand-ice rounded-lg p-6">
        <label htmlFor="verify-address" className="block font-semibold text-brand-ink mb-2 flex items-center gap-2">
          <MapPin className="w-5 h-5 text-brand-wave-blue" />
          {t("edit")}
        </label>
        <input
          id="verify-address"
          type="text"
          value={address}
          onChange={(e) => { setAddress(e.target.value); setConfirmed(false); }}
          placeholder="e.g. 6911 No 1 Rd, Richmond, BC"
          className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-brand-wave-blue focus:ring-2 focus:ring-brand-wave-blue/20 outline-none transition-all"
        />
        {confirmed && (
          <div className="mt-3 flex items-center gap-2 text-sm text-state-success">
            <CheckCircle2 className="w-4 h-4" />
            {t("verifiedFromBc")}
          </div>
        )}
      </div>

      {/* Botón de confirmación visual — solo feedback, el Next del wizard avanza */}
      <button
        type="button"
        onClick={() => setConfirmed(true)}
        disabled={!address.trim() || address.trim().length < 5}
        className="w-full px-6 py-3 bg-brand-navy text-white rounded-lg font-medium hover:bg-brand-navy-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {confirmed ? "✓ " : ""}{t("doneEditing")}
      </button>
    </div>
  );
}

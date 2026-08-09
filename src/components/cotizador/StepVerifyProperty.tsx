"use client";

import React, { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { MapPin, CheckCircle2, Edit2 } from "lucide-react";

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

  const [address, setAddress] = useState(initial?.address || rawAddress || "");
  const [isEditingAddress, setIsEditingAddress] = useState(false);

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

  const displayAddress = address.trim() || (initial?.zone ? `${initial.zone}, BC` : "");

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-brand-ink mb-2">{t("title")}</h2>
        <p className="text-gray-600">{t("subtitleManual")}</p>
      </div>

      {/* Confirmed Property Address Preview (read-only if address already present) */}
      {displayAddress && (
        <div className="bg-brand-ice rounded-lg p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-state-success/10 text-state-success flex items-center justify-center flex-shrink-0">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div>
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider block">
                {t("confirmedAddressLabel")}
              </span>
              <span className="text-sm font-semibold text-brand-ink block">
                {displayAddress}
              </span>
            </div>
          </div>
          {!isEditingAddress ? (
            <button
              type="button"
              onClick={() => setIsEditingAddress(true)}
              className="text-xs font-medium text-brand-wave-blue hover:underline flex items-center gap-1 flex-shrink-0 ml-2"
            >
              <Edit2 className="w-3.5 h-3.5" />
              {t("edit")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setIsEditingAddress(false)}
              className="text-xs font-medium text-state-success hover:underline flex items-center gap-1 flex-shrink-0 ml-2"
            >
              ✓ {t("doneEditing")}
            </button>
          )}
        </div>
      )}

      {isEditingAddress && (
        <div className="bg-brand-ice rounded-lg p-4">
          <label htmlFor="verify-address-edit" className="block text-xs font-medium text-gray-600 mb-1 flex items-center gap-1">
            <MapPin className="w-3.5 h-3.5 text-brand-wave-blue" />
            {t("edit")}
          </label>
          <input
            id="verify-address-edit"
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="e.g. 6911 No 1 Rd, Richmond, BC"
            className="w-full px-4 py-2.5 rounded-lg border border-gray-200 focus:border-brand-wave-blue focus:ring-2 focus:ring-brand-wave-blue/20 outline-none text-sm transition-all"
          />
        </div>
      )}

      {/* Property Details Card Summary */}
      <div className="bg-brand-ice rounded-lg p-6 space-y-3">
        <h3 className="font-semibold text-brand-ink text-sm uppercase tracking-wider">
          {t("propertyTypeLabel")}
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          <div className="p-3 bg-white rounded-lg border border-gray-200">
            <span className="text-xs text-gray-500 block">{t("zoneLabel")}</span>
            <span className="font-medium text-brand-ink">{initial?.zone || "Richmond"}</span>
          </div>
          <div className="p-3 bg-white rounded-lg border border-gray-200">
            <span className="text-xs text-gray-500 block">ft²</span>
            <span className="font-medium text-brand-ink">{(initial?.squareFeet ?? 1000).toLocaleString()} ft²</span>
          </div>
          <div className="p-3 bg-white rounded-lg border border-gray-200 col-span-2 sm:col-span-1">
            <span className="text-xs text-gray-500 block">{t("propertyTypeLabel")}</span>
            <span className="font-medium text-brand-ink">
              {initial?.serviceCategory === "commercial" ? t("propertyTypeCommercial") : t("propertyTypeResidential")}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}


"use client";

import React, { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Home, Building2, BedDouble, Bath, Ruler, MapPin, AlertCircle, Pencil, CheckCircle2 } from "lucide-react";
import type { BcAssessmentResult } from "@/lib/bc-assessment";
import { ACTIVE_ZONES } from "@/lib/pricing";

export interface VerifiedProperty {
  address: string;
  zone: string;
  postalCode: string;
  serviceCategory: "home" | "commercial";
  bedrooms: number;
  bathrooms: number;
  squareFeet: number;
  /** Lo que el cliente declaró — puede diferir de squareFeet. Solo para factura. */
  squareFeetDeclared: number;
}

interface StepVerifyPropertyProps {
  /** Dirección que el cliente escribió en el paso anterior. */
  rawAddress: string;
  /** Resultado de BC Assessment (puede ser null si no hay proveedor o falló). */
  bcResult: BcAssessmentResult | null;
  /** Valores previamente confirmados (si el cliente vuelve atrás a editar). */
  initial?: Partial<VerifiedProperty>;
  onChange: (data: VerifiedProperty) => void;
}

export function StepVerifyProperty({ rawAddress, bcResult, initial, onChange }: StepVerifyPropertyProps) {
  const t = useTranslations("cotizador.verify");

  const isAvailable = bcResult && bcResult.confidence !== "unavailable" && bcResult.squareFeet;

  // Estado editable — si no hay datos de BC Assessment, entramos directo en modo edición
  const [editing, setEditing] = useState(!isAvailable);
  const [address, setAddress] = useState(initial?.address ?? bcResult?.completeAddress ?? rawAddress);
  const [zone, setZone] = useState(initial?.zone ?? (bcResult?.postalCode ? inferZoneFromPostal(bcResult.postalCode) : ""));
  const [postalCode] = useState(initial?.postalCode ?? bcResult?.postalCode ?? "");
  const [serviceCategory, setServiceCategory] = useState<"home" | "commercial">(
    initial?.serviceCategory ?? (bcResult?.propertyType === "commercial" ? "commercial" : "home")
  );
  const [bedrooms, setBedrooms] = useState(initial?.bedrooms ?? bcResult?.bedrooms ?? 2);
  const [bathrooms, setBathrooms] = useState(initial?.bathrooms ?? bcResult?.bathrooms ?? 1);
  const [squareFeet, setSquareFeet] = useState(initial?.squareFeet ?? bcResult?.squareFeet ?? 1000);
  const [squareFeetDeclared, setSquareFeetDeclared] = useState(
    initial?.squareFeetDeclared ?? bcResult?.squareFeet ?? squareFeet
  );

  // Emitir al padre en cada cambio. onChange se guarda en ref para evitar
  // re-disparos por cambio de referencia (es inline en el padre).
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    onChangeRef.current({
      address,
      zone,
      postalCode,
      serviceCategory,
      bedrooms,
      bathrooms,
      squareFeet,
      squareFeetDeclared,
    });
  }, [address, zone, postalCode, serviceCategory, bedrooms, bathrooms, squareFeet, squareFeetDeclared]);
  // eslint-disable-next-line react-hooks/exhaustive-deps

  const hasBcData = isAvailable;

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-brand-ink mb-2">{t("title")}</h2>
        <p className="text-gray-600">{hasBcData ? t("subtitleFound") : t("subtitleManual")}</p>
      </div>

      {/* ── Tarjeta de propiedad ── */}
      <div className="bg-brand-ice rounded-lg p-6 border-2 border-brand-gold/30">
        <div className="flex items-start gap-3 mb-4">
          {serviceCategory === "commercial" ? (
            <Building2 className="w-8 h-8 text-brand-wave-blue mt-1 flex-shrink-0" />
          ) : (
            <Home className="w-8 h-8 text-brand-wave-blue mt-1 flex-shrink-0" />
          )}
          <div className="flex-1">
            <h3 className="font-semibold text-brand-ink text-lg">
              {serviceCategory === "commercial" ? t("propertyTypeCommercial") : t("propertyTypeResidential")}
            </h3>
          </div>
          <button
            type="button"
            onClick={() => setEditing(!editing)}
            className="flex items-center gap-1 text-sm text-brand-wave-blue hover:underline flex-shrink-0"
          >
            <Pencil className="w-4 h-4" />
            {editing ? t("doneEditing") : t("edit")}
          </button>
        </div>

        {/* Dirección */}
        <div className="flex items-start gap-2 text-sm text-gray-700 mb-4">
          <MapPin className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
          {editing ? (
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="flex-1 px-3 py-1.5 rounded border border-gray-200 text-sm"
            />
          ) : (
            <span>{address}{postalCode ? ` — ${postalCode}` : ""}</span>
          )}
        </div>

        {/* Grid: cuartos, baños, área */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Bedrooms */}
          <div className="flex items-center gap-2 text-sm">
            <BedDouble className="w-4 h-4 text-gray-400 flex-shrink-0" />
            {editing ? (
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  value={bedrooms}
                  onChange={(e) => setBedrooms(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-16 px-2 py-1 rounded border border-gray-200 text-sm text-center"
                />
                <span className="text-xs text-gray-500">{t("bedrooms")}</span>
              </div>
            ) : (
              <span>{bedrooms} {t("bedrooms")}</span>
            )}
          </div>

          {/* Bathrooms */}
          <div className="flex items-center gap-2 text-sm">
            <Bath className="w-4 h-4 text-gray-400 flex-shrink-0" />
            {editing ? (
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  value={bathrooms}
                  onChange={(e) => setBathrooms(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-16 px-2 py-1 rounded border border-gray-200 text-sm text-center"
                />
                <span className="text-xs text-gray-500">{t("bathrooms")}</span>
              </div>
            ) : (
              <span>{bathrooms} {t("bathrooms")}</span>
            )}
          </div>

          {/* Square Feet */}
          <div className="flex items-center gap-2 text-sm">
            <Ruler className="w-4 h-4 text-gray-400 flex-shrink-0" />
            {editing ? (
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={300}
                  max={10000}
                  step={100}
                  value={squareFeet}
                  onChange={(e) => setSquareFeet(Math.max(300, parseInt(e.target.value) || 300))}
                  className="w-20 px-2 py-1 rounded border border-gray-200 text-sm text-center"
                />
                <span className="text-xs text-gray-500">ft²</span>
              </div>
            ) : (
              <span>{squareFeet.toLocaleString()} ft²</span>
            )}
          </div>
        </div>

        {/* Área declarada por el cliente */}
        {!editing && squareFeetDeclared !== squareFeet && (
          <div className="mt-3 pt-3 border-t border-gray-200 text-xs text-gray-500 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            {t("declaredDiffers", { declared: squareFeetDeclared.toLocaleString(), official: squareFeet.toLocaleString() })}
          </div>
        )}

        {/* Si está en modo edición, mostrar input de sq ft declarado */}
        {editing && (
          <div className="mt-3 pt-3 border-t border-gray-200">
            <label className="text-xs text-gray-500 flex items-center gap-1 mb-1">
              <AlertCircle className="w-3 h-3" />
              {t("declaredLabel")}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={300}
                max={10000}
                step={100}
                value={squareFeetDeclared}
                onChange={(e) => setSquareFeetDeclared(Math.max(300, parseInt(e.target.value) || 300))}
                className="w-24 px-2 py-1 rounded border border-gray-200 text-sm text-center"
              />
              <span className="text-xs text-gray-400">ft² — {t("declaredHint")}</span>
            </div>
          </div>
        )}

        {/* Zona */}
        {editing && (
          <div className="mt-3 pt-3 border-t border-gray-200">
            <label className="text-xs text-gray-500 block mb-1">{t("zoneLabel")}</label>
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
        )}

        {/* Tipo de propiedad (edición) */}
        {editing && (
          <div className="mt-3 pt-3 border-t border-gray-200">
            <label className="text-xs text-gray-500 block mb-1">{t("propertyTypeLabel")}</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setServiceCategory("home")}
                className={`px-4 py-2 rounded-lg border text-sm font-medium transition-all ${
                  serviceCategory === "home"
                    ? "border-brand-gold bg-brand-gold/10 text-brand-ink"
                    : "border-gray-200 text-gray-600 hover:border-brand-wave-blue"
                }`}
              >
                🏠 {t("propertyTypeResidential")}
              </button>
              <button
                type="button"
                onClick={() => setServiceCategory("commercial")}
                className={`px-4 py-2 rounded-lg border text-sm font-medium transition-all ${
                  serviceCategory === "commercial"
                    ? "border-brand-gold bg-brand-gold/10 text-brand-ink"
                    : "border-gray-200 text-gray-600 hover:border-brand-wave-blue"
                }`}
              >
                🏢 {t("propertyTypeCommercial")}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Si no hay datos de BC Assessment ── */}
      {!hasBcData && !editing && (
        <div className="p-4 bg-brand-gold/10 border border-brand-gold/30 rounded-lg text-sm text-center">
          <AlertCircle className="w-5 h-5 text-brand-gold mx-auto mb-2" />
          <p className="text-brand-ink">{t("noBcData")}</p>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="mt-2 inline-flex items-center gap-1 text-brand-wave-blue font-medium hover:underline"
          >
            <Pencil className="w-4 h-4" />
            {t("enterManually")}
          </button>
        </div>
      )}

      {/* ── Badge de fuente ── */}
      {hasBcData && !editing && (
        <div className="flex items-center justify-center gap-2 text-xs text-state-success">
          <CheckCircle2 className="w-4 h-4" />
          {t("verifiedFromBc")}
        </div>
      )}
    </div>
  );
}

/** Inferir zona desde código postal. Fallback: vacío (el cliente elige). */
function inferZoneFromPostal(postalCode: string): string {
  const prefix = postalCode.replace(/\s/g, "").toUpperCase().slice(0, 3);
  // Mapeo de FSA a zonas de servicio conocidas en Richmond/Vancouver
  const fsaMap: Record<string, string> = {
    V6X: "Richmond",
    V6Y: "Richmond",
    V7A: "Richmond",
    V7B: "Richmond",
    V7C: "Richmond",
    V7E: "Richmond",
    V6T: "UBC",
    V6S: "UBC",
    V6K: "Kitsilano",
    V6L: "Kitsilano",
    V6R: "Kitsilano",
    V6N: "Kitsilano",
    V6M: "Vancouver West",
    V6P: "Vancouver West",
    V5K: "Vancouver East",
    V5L: "Vancouver East",
    V5M: "Vancouver East",
    V5N: "Vancouver East",
    V5T: "Vancouver East",
    V5Y: "Vancouver West",
    V6Z: "Vancouver West",
    V6H: "Vancouver West",
    V6J: "Vancouver West",
  };
  return fsaMap[prefix] ?? "";
}

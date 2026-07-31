"use client";

import React, { useState } from "react";
import { Phone, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import {
  ACTIVE_ZONES,
  SERVICE_CATEGORIES,
  SERVICE_SUBTYPES,
  PET_TYPES,
  type ServiceCategory,
} from "@/lib/pricing";
import { useTranslations } from "next-intl";

/**
 * v8.3 E6.6 — Reserva por teléfono (herramienta del coordinador).
 *
 * Formulario simple dedicado (no reutiliza los componentes cliente del
 * cotizador web src/components/cotizador/* porque están acoplados al flujo
 * de auth del propio cliente -- localStorage de su sesión, AuthModal, pasos
 * de UX pensados para que el cliente teclee su propia info). Lo que SÍ se
 * reutiliza -- y es lo que realmente garantiza que el precio sea idéntico
 * al del cotizador web -- es el cálculo: este formulario llama a
 * /api/admin/phone-booking, que importa y ejecuta las MISMAS funciones de
 * src/lib/pricing.ts que /api/quote/route.ts (ver comentario en ese archivo).
 *
 * HONESTO: esto NO toma el pago. Ver "nextStep" en la respuesta del API --
 * el pago sigue pasando por /api/stripe/confirm (SetupIntent seguro), nunca
 * tarjeta dictada por teléfono y tecleada aquí (PCI).
 */
export default function PhoneBookingPage() {
  const t = useTranslations("admin.phoneBooking");
  const [form, setForm] = useState({
    clientEmail: "",
    clientFullName: "",
    clientPhone: "",
    serviceCategory: "home" as ServiceCategory,
    serviceSubtype: "regular",
    bedrooms: 2,
    bathrooms: 1,
    squareFeet: 1000,
    petsCount: 0,
    petsType: "none",
    residents: 2,
    daysSinceCleaning: 30,
    address: "",
    zone: "Richmond",
    postalCode: "",
    purchaseOrder: "",
    noSmartphoneFlow: false,
    printedInvoiceRequested: false,
    consentConfirmedVerballyByCoordinator: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [result, setResult] = useState<any>(null);

  // Item 9 (auditoría 2026-07-25): antes no se validaba formato de email,
  // teléfono ni código postal canadiense antes de enviar -- errores tipográficos
  // del coordinador (dictados por teléfono) llegaban directo a la API.
  const [fieldErrors, setFieldErrors] = useState<{ clientEmail?: string; clientPhone?: string; postalCode?: string }>({});

  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  // Teléfono canadiense: 10 dígitos, con o sin +1, separadores opcionales de espacio/guion/paréntesis.
  const CA_PHONE_REGEX = /^(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$/;
  // Código postal canadiense: A1A 1A1 (espacio opcional).
  const CA_POSTAL_REGEX = /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/;

  // Item 9 (auditoría 2026-07-30): Number(e.target.value) da NaN cuando el
  // campo queda vacío o con un valor parcial ("-", "."), y ese NaN se
  // serializaba tal cual hacia el backend. numericFieldsValid se usa tanto
  // para deshabilitar el submit como dentro de validateForm().
  const numericFieldsValid =
    Number.isFinite(form.bedrooms) &&
    form.bedrooms >= 0 &&
    Number.isFinite(form.bathrooms) &&
    form.bathrooms >= 0 &&
    Number.isFinite(form.squareFeet) &&
    form.squareFeet >= 300 &&
    Number.isFinite(form.residents) &&
    form.residents >= 1 &&
    Number.isFinite(form.petsCount) &&
    form.petsCount >= 0 &&
    Number.isFinite(form.daysSinceCleaning) &&
    form.daysSinceCleaning >= 0;

  function validateForm(): boolean {
    const errors: typeof fieldErrors = {};
    if (!EMAIL_REGEX.test(form.clientEmail.trim())) {
      errors.clientEmail = t("errorInvalidEmail");
    }
    if (form.clientPhone.trim() && !CA_PHONE_REGEX.test(form.clientPhone.trim())) {
      errors.clientPhone = t("errorInvalidPhone");
    }
    if (!CA_POSTAL_REGEX.test(form.postalCode.trim())) {
      errors.postalCode = t("errorInvalidPostalCode");
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0 && numericFieldsValid;
  }

  const subtypes = SERVICE_SUBTYPES[form.serviceCategory];
  const mappedServiceType = subtypes.find((s) => s.key === form.serviceSubtype)?.mapsTo;

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setResult(null);
    if (!validateForm()) {
      setError(t("errorFixFields"));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/admin/phone-booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...form,
          serviceType: mappedServiceType,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t("errorCreating"));
        return;
      }
      setResult(data);
    } catch {
      setError(t("errorNetwork"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-brand-ice">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="flex items-center gap-2 mb-1">
          <Phone className="w-5 h-5 text-brand-navy" />
          <h1 className="text-xl font-bold text-brand-ink">{t("title")}</h1>
        </div>
        <p className="text-sm text-gray-600 mb-6">{t("subtitle")}</p>

        <form onSubmit={submit} className="bg-white rounded-xl shadow-elevation-1 p-5 space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-brand-ink">{t("client")}</legend>
            <input
              type="email"
              required
              aria-label={t("clientEmail")}
              aria-invalid={!!fieldErrors.clientEmail}
              placeholder={t("clientEmail")}
              value={form.clientEmail}
              onChange={(e) => update("clientEmail", e.target.value)}
              className={`w-full border rounded-lg p-2 text-sm ${fieldErrors.clientEmail ? "border-red-400" : ""}`}
            />
            {fieldErrors.clientEmail && (
              <p className="text-xs text-red-600">{fieldErrors.clientEmail}</p>
            )}
            <input
              type="text"
              aria-label={t("clientFullName")}
              placeholder={t("clientFullName")}
              value={form.clientFullName}
              onChange={(e) => update("clientFullName", e.target.value)}
              className="w-full border rounded-lg p-2 text-sm"
            />
            <input
              type="tel"
              aria-label={t("clientPhone")}
              aria-invalid={!!fieldErrors.clientPhone}
              placeholder={t("clientPhonePlaceholder")}
              value={form.clientPhone}
              onChange={(e) => update("clientPhone", e.target.value)}
              className={`w-full border rounded-lg p-2 text-sm ${fieldErrors.clientPhone ? "border-red-400" : ""}`}
            />
            {fieldErrors.clientPhone && (
              <p className="text-xs text-red-600">{fieldErrors.clientPhone}</p>
            )}
          </fieldset>

          <fieldset className="grid grid-cols-2 gap-2">
            <legend className="text-sm font-semibold text-brand-ink col-span-2">{t("service")}</legend>
            <label className="text-xs text-gray-600">
              {t("category")}
              <select
                aria-label={t("serviceCategory")}
                value={form.serviceCategory}
                onChange={(e) => {
                  const cat = e.target.value as ServiceCategory;
                  update("serviceCategory", cat);
                  update("serviceSubtype", SERVICE_SUBTYPES[cat][0].key);
                }}
                className="w-full border rounded-lg p-2 text-sm mt-1"
              >
                {SERVICE_CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-gray-600">
              {t("subtype")}
              <select
                aria-label={t("serviceSubtype")}
                value={form.serviceSubtype}
                onChange={(e) => update("serviceSubtype", e.target.value)}
                className="w-full border rounded-lg p-2 text-sm mt-1"
              >
                {subtypes.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-gray-600">
              {t("bedrooms")}
              <input type="number" min={0} aria-label={t("bedrooms")} value={form.bedrooms}
                onChange={(e) => update("bedrooms", Number(e.target.value))}
                className="w-full border rounded-lg p-2 text-sm mt-1" />
            </label>
            <label className="text-xs text-gray-600">
              {t("bathrooms")}
              <input type="number" min={0} aria-label={t("bathrooms")} value={form.bathrooms}
                onChange={(e) => update("bathrooms", Number(e.target.value))}
                className="w-full border rounded-lg p-2 text-sm mt-1" />
            </label>
            <label className="text-xs text-gray-600">
              {t("squareFeet")}
              <input type="number" min={300} max={10000} aria-label={t("squareFeet")} value={form.squareFeet}
                onChange={(e) => update("squareFeet", Number(e.target.value))}
                className="w-full border rounded-lg p-2 text-sm mt-1" />
            </label>
            <label className="text-xs text-gray-600">
              {t("residents")}
              <input type="number" min={1} aria-label={t("residents")} value={form.residents}
                onChange={(e) => update("residents", Number(e.target.value))}
                className="w-full border rounded-lg p-2 text-sm mt-1" />
            </label>
            <label className="text-xs text-gray-600">
              {t("petsCount")}
              <input type="number" min={0} aria-label={t("petsCount")} value={form.petsCount}
                onChange={(e) => update("petsCount", Number(e.target.value))}
                className="w-full border rounded-lg p-2 text-sm mt-1" />
            </label>
            <label className="text-xs text-gray-600">
              {t("petsType")}
              <select aria-label={t("petsType")} value={form.petsType}
                onChange={(e) => update("petsType", e.target.value)}
                className="w-full border rounded-lg p-2 text-sm mt-1">
                {PET_TYPES.map((p) => (<option key={p} value={p}>{p}</option>))}
              </select>
            </label>
            <label className="text-xs text-gray-600 col-span-2">
              {t("daysSinceCleaning")}
              <input type="number" min={0} aria-label={t("daysSinceCleaningAria")} value={form.daysSinceCleaning}
                onChange={(e) => update("daysSinceCleaning", Number(e.target.value))}
                className="w-full border rounded-lg p-2 text-sm mt-1" />
            </label>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-brand-ink">{t("address")}</legend>
            <input type="text" required aria-label={t("address")} placeholder={t("fullAddress")}
              value={form.address} onChange={(e) => update("address", e.target.value)}
              className="w-full border rounded-lg p-2 text-sm" />
            <div className="grid grid-cols-2 gap-2">
              <select aria-label={t("zone")} value={form.zone} onChange={(e) => update("zone", e.target.value)}
                className="w-full border rounded-lg p-2 text-sm">
                {ACTIVE_ZONES.map((z) => (<option key={z.name} value={z.name}>{z.name}</option>))}
              </select>
              <input type="text" required aria-label={t("postalCode")} aria-invalid={!!fieldErrors.postalCode} placeholder={t("postalCode")}
                value={form.postalCode} onChange={(e) => update("postalCode", e.target.value)}
                className={`w-full border rounded-lg p-2 text-sm ${fieldErrors.postalCode ? "border-red-400" : ""}`} />
            </div>
            {fieldErrors.postalCode && (
              <p className="text-xs text-red-600">{fieldErrors.postalCode}</p>
            )}
          </fieldset>

          {form.serviceCategory === "commercial" && (
            <input type="text" aria-label={t("purchaseOrderNumber")} placeholder={t("poPlaceholder")}
              value={form.purchaseOrder} onChange={(e) => update("purchaseOrder", e.target.value)}
              className="w-full border rounded-lg p-2 text-sm" />
          )}

          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-brand-ink">{t("inclusion")}</legend>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" aria-label={t("noSmartphoneAria")} checked={form.noSmartphoneFlow}
                onChange={(e) => update("noSmartphoneFlow", e.target.checked)} />
              {t("noSmartphoneLabel")}
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" aria-label={t("printedInvoiceAria")} checked={form.printedInvoiceRequested}
                onChange={(e) => update("printedInvoiceRequested", e.target.checked)} />
              {t("printedInvoiceLabel")}
            </label>
          </fieldset>

          <label className="flex items-start gap-2 text-sm text-gray-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
            <input type="checkbox" required aria-label={t("consentAria")}
              checked={form.consentConfirmedVerballyByCoordinator}
              onChange={(e) => update("consentConfirmedVerballyByCoordinator", e.target.checked)} />
            {t("consentLabel")}
          </label>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          <button type="submit" disabled={loading || !numericFieldsValid}
            className="w-full bg-brand-navy text-white rounded-lg py-2.5 font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Phone className="w-4 h-4" />}
            {t("createQuote")}
          </button>
        </form>

        {result && (
          <div className="bg-white rounded-xl shadow-elevation-1 p-5 mt-4 space-y-3">
            <div className="flex items-center gap-2 text-state-success font-semibold text-sm">
              <CheckCircle2 className="w-4 h-4" />
              {t("quoteCreated")}
            </div>
            <div className="text-sm space-y-1 text-gray-700">
              <div className="flex justify-between"><span>{t("basePrice")}</span><span>${result.breakdownForCoordinatorToRead.basePrice.toFixed(2)}</span></div>
              {result.breakdownForCoordinatorToRead.printedInvoiceCharge > 0 && (
                <div className="flex justify-between"><span>{t("printedInvoice")}</span><span>+${result.breakdownForCoordinatorToRead.printedInvoiceCharge.toFixed(2)}</span></div>
              )}
              <div className="flex justify-between font-semibold border-t pt-1"><span>{t("subtotal")}</span><span>${result.breakdownForCoordinatorToRead.subtotal.toFixed(2)}</span></div>
              <div className="flex justify-between text-xs text-gray-500"><span>{t("gst")}</span><span>${result.breakdownForCoordinatorToRead.gst.toFixed(2)}</span></div>
              <div className="flex justify-between text-xs text-gray-500"><span>{t("pst")}</span><span>${result.breakdownForCoordinatorToRead.pst.toFixed(2)}</span></div>
              <div className="flex justify-between font-bold text-brand-navy border-t pt-1"><span>{t("total")}</span><span>${result.breakdownForCoordinatorToRead.total.toFixed(2)}</span></div>
              <div className="flex justify-between text-xs text-gray-500"><span>{t("reservationHold")}</span><span>${result.breakdownForCoordinatorToRead.holdAmount.toFixed(2)}</span></div>
            </div>
            {result.adminReviewRequired && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-xs text-amber-800">
                {t("needsAdminReview")}
              </div>
            )}
            <p className="text-xs text-gray-500 border-t pt-2">{result.nextStep}</p>
            <p className="text-xs text-gray-400">{t("quoteId", { id: result.quoteId })}</p>
          </div>
        )}
      </div>
    </main>
  );
}

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

  const subtypes = SERVICE_SUBTYPES[form.serviceCategory];
  const mappedServiceType = subtypes.find((s) => s.key === form.serviceSubtype)?.mapsTo;

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);
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
        setError(data.error || "Could not create the phone quote.");
        return;
      }
      setResult(data);
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-brand-ice">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="flex items-center gap-2 mb-1">
          <Phone className="w-5 h-5 text-brand-navy" />
          <h1 className="text-xl font-bold text-brand-ink">Phone Booking</h1>
        </div>
        <p className="text-sm text-gray-600 mb-6">
          Take the same inputs the web quoter asks for while on the call. The price is
          calculated by the exact same server-side pricing engine — never re-typed or
          estimated by hand. Payment is never collected here (PCI) — see the secure
          link instructions after you submit.
        </p>

        <form onSubmit={submit} className="bg-white rounded-xl shadow-elevation-1 p-5 space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-brand-ink">Client</legend>
            <input
              type="email"
              required
              aria-label="Client email"
              placeholder="Client email"
              value={form.clientEmail}
              onChange={(e) => update("clientEmail", e.target.value)}
              className="w-full border rounded-lg p-2 text-sm"
            />
            <input
              type="text"
              aria-label="Client full name"
              placeholder="Client full name"
              value={form.clientFullName}
              onChange={(e) => update("clientFullName", e.target.value)}
              className="w-full border rounded-lg p-2 text-sm"
            />
            <input
              type="tel"
              aria-label="Client phone"
              placeholder="Client phone (the number you're speaking on)"
              value={form.clientPhone}
              onChange={(e) => update("clientPhone", e.target.value)}
              className="w-full border rounded-lg p-2 text-sm"
            />
          </fieldset>

          <fieldset className="grid grid-cols-2 gap-2">
            <legend className="text-sm font-semibold text-brand-ink col-span-2">Service</legend>
            <label className="text-xs text-gray-600">
              Category
              <select
                aria-label="Service category"
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
              Subtype
              <select
                aria-label="Service subtype"
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
              Bedrooms
              <input type="number" min={0} aria-label="Bedrooms" value={form.bedrooms}
                onChange={(e) => update("bedrooms", Number(e.target.value))}
                className="w-full border rounded-lg p-2 text-sm mt-1" />
            </label>
            <label className="text-xs text-gray-600">
              Bathrooms
              <input type="number" min={0} aria-label="Bathrooms" value={form.bathrooms}
                onChange={(e) => update("bathrooms", Number(e.target.value))}
                className="w-full border rounded-lg p-2 text-sm mt-1" />
            </label>
            <label className="text-xs text-gray-600">
              Square feet
              <input type="number" min={300} max={10000} aria-label="Square feet" value={form.squareFeet}
                onChange={(e) => update("squareFeet", Number(e.target.value))}
                className="w-full border rounded-lg p-2 text-sm mt-1" />
            </label>
            <label className="text-xs text-gray-600">
              Residents
              <input type="number" min={1} aria-label="Residents" value={form.residents}
                onChange={(e) => update("residents", Number(e.target.value))}
                className="w-full border rounded-lg p-2 text-sm mt-1" />
            </label>
            <label className="text-xs text-gray-600">
              Pets count
              <input type="number" min={0} aria-label="Pets count" value={form.petsCount}
                onChange={(e) => update("petsCount", Number(e.target.value))}
                className="w-full border rounded-lg p-2 text-sm mt-1" />
            </label>
            <label className="text-xs text-gray-600">
              Pets type
              <select aria-label="Pets type" value={form.petsType}
                onChange={(e) => update("petsType", e.target.value)}
                className="w-full border rounded-lg p-2 text-sm mt-1">
                {PET_TYPES.map((p) => (<option key={p} value={p}>{p}</option>))}
              </select>
            </label>
            <label className="text-xs text-gray-600 col-span-2">
              Days since last professional cleaning
              <input type="number" min={0} aria-label="Days since last cleaning" value={form.daysSinceCleaning}
                onChange={(e) => update("daysSinceCleaning", Number(e.target.value))}
                className="w-full border rounded-lg p-2 text-sm mt-1" />
            </label>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-brand-ink">Address</legend>
            <input type="text" required aria-label="Address" placeholder="Full address"
              value={form.address} onChange={(e) => update("address", e.target.value)}
              className="w-full border rounded-lg p-2 text-sm" />
            <div className="grid grid-cols-2 gap-2">
              <select aria-label="Zone" value={form.zone} onChange={(e) => update("zone", e.target.value)}
                className="w-full border rounded-lg p-2 text-sm">
                {ACTIVE_ZONES.map((z) => (<option key={z.name} value={z.name}>{z.name}</option>))}
              </select>
              <input type="text" required aria-label="Postal code" placeholder="Postal code"
                value={form.postalCode} onChange={(e) => update("postalCode", e.target.value)}
                className="w-full border rounded-lg p-2 text-sm" />
            </div>
          </fieldset>

          {form.serviceCategory === "commercial" && (
            <input type="text" aria-label="Purchase order number" placeholder="PO number (required for B2B/Government)"
              value={form.purchaseOrder} onChange={(e) => update("purchaseOrder", e.target.value)}
              className="w-full border rounded-lg p-2 text-sm" />
          )}

          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-brand-ink">Inclusion (E6.6)</legend>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" aria-label="Client has no smartphone" checked={form.noSmartphoneFlow}
                onChange={(e) => update("noSmartphoneFlow", e.target.checked)} />
              Client has no smartphone (call back 2h after service instead of photo gallery; allows
              e-transfer/cheque/cash with signed receipt)
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" aria-label="Client requests printed invoice" checked={form.printedInvoiceRequested}
                onChange={(e) => update("printedInvoiceRequested", e.target.checked)} />
              Client requests printed invoice by mail (+$2; always included free for B2B/Government)
            </label>
          </fieldset>

          <label className="flex items-start gap-2 text-sm text-gray-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
            <input type="checkbox" required aria-label="Coordinator confirms verbal consent"
              checked={form.consentConfirmedVerballyByCoordinator}
              onChange={(e) => update("consentConfirmedVerballyByCoordinator", e.target.checked)} />
            I read the Terms &amp; Conditions and PIPA notice to the client and they accepted verbally.
          </label>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          <button type="submit" disabled={loading}
            className="w-full bg-brand-navy text-white rounded-lg py-2.5 font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Phone className="w-4 h-4" />}
            Create phone quote
          </button>
        </form>

        {result && (
          <div className="bg-white rounded-xl shadow-elevation-1 p-5 mt-4 space-y-3">
            <div className="flex items-center gap-2 text-state-success font-semibold text-sm">
              <CheckCircle2 className="w-4 h-4" />
              Quote created — read this breakdown to the client
            </div>
            <div className="text-sm space-y-1 text-gray-700">
              <div className="flex justify-between"><span>Base price</span><span>${result.breakdownForCoordinatorToRead.basePrice.toFixed(2)}</span></div>
              {result.breakdownForCoordinatorToRead.printedInvoiceCharge > 0 && (
                <div className="flex justify-between"><span>Printed invoice</span><span>+${result.breakdownForCoordinatorToRead.printedInvoiceCharge.toFixed(2)}</span></div>
              )}
              <div className="flex justify-between font-semibold border-t pt-1"><span>Subtotal</span><span>${result.breakdownForCoordinatorToRead.subtotal.toFixed(2)}</span></div>
              <div className="flex justify-between text-xs text-gray-500"><span>GST</span><span>${result.breakdownForCoordinatorToRead.gst.toFixed(2)}</span></div>
              <div className="flex justify-between text-xs text-gray-500"><span>PST</span><span>${result.breakdownForCoordinatorToRead.pst.toFixed(2)}</span></div>
              <div className="flex justify-between font-bold text-brand-navy border-t pt-1"><span>Total</span><span>${result.breakdownForCoordinatorToRead.total.toFixed(2)}</span></div>
              <div className="flex justify-between text-xs text-gray-500"><span>Reservation hold</span><span>${result.breakdownForCoordinatorToRead.holdAmount.toFixed(2)}</span></div>
            </div>
            {result.adminReviewRequired && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-xs text-amber-800">
                This quote needs manual admin review before it can be scheduled.
              </div>
            )}
            <p className="text-xs text-gray-500 border-t pt-2">{result.nextStep}</p>
            <p className="text-xs text-gray-400">Quote ID: {result.quoteId}</p>
          </div>
        )}
      </div>
    </main>
  );
}

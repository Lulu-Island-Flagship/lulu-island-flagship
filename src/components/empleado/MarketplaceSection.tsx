"use client";

/**
 * v8.3 F.8 — Sección de Marketplace de Turnos para el dashboard del empleado.
 *
 * Muestra turnos disponibles para cubrir y permite ofrecerse como voluntario.
 * Solo se renderiza si el feature flag `turn_marketplace_enabled` está activo
 * (el endpoint /api/employee/turn-marketplace devuelve 503 si no).
 */

import React, { useState, useEffect, useCallback } from "react";
import { ArrowRightLeft, RefreshCw, CheckCircle2, Loader2, Calendar } from "lucide-react";

interface MarketplaceOffer {
  id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  zone: string;
  estimated_pay_cents: number;
  note: string | null;
  status: string;
  original_employee_name: string | null;
  offering_employee_name: string | null;
}

function formatPay(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(shiftDate: string, locale: string): string {
  const intlLocale = locale === "zh" ? "zh-CN" : locale === "fr" ? "fr-CA" : "en-CA";
  return new Date(shiftDate + "T12:00:00").toLocaleDateString(intlLocale, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

export default function MarketplaceSection({ locale }: { locale: string }) {
  const [offers, setOffers] = useState<MarketplaceOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [visible, setVisible] = useState(false);
  const [offeringIds, setOfferingIds] = useState<Set<string>>(new Set());
  const [offeringId, setOfferingId] = useState<string | null>(null);

  const loadOffers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/employee/turn-marketplace", {
        credentials: "include",
      });
      if (res.status === 503) {
        setVisible(false);
        setOffers([]);
        setLoading(false);
        return;
      }
      if (!res.ok) {
        setVisible(false);
        setOffers([]);
        setLoading(false);
        return;
      }
      const data = await res.json();
      const list = data.offers || [];
      setOffers(list);
      setVisible(true);
      setLoading(false);
    } catch {
      setVisible(false);
      setOffers([]);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOffers();
  }, [loadOffers]);

  async function handleOfferToCover(offerId: string) {
    setOfferingId(offerId);
    setError("");
    try {
      const res = await fetch("/api/employee/turn-marketplace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ marketplaceOfferId: offerId }),
      });
      if (res.ok) {
        setOfferingIds((prev) => new Set(prev).add(offerId));
        setOffers((prev) =>
          prev.map((o) =>
            o.id === offerId ? { ...o, status: "offer_submitted" } : o
          )
        );
      } else {
        const err = await res.json().catch(() => null);
        setError(err?.error || "No se pudo registrar la oferta");
      }
    } catch {
      setError("Error de conexión al registrar la oferta");
    } finally {
      setOfferingId(null);
    }
  }

  // Si no está visible y ya cargó (no es el loading inicial), no renderizar nada
  if (!loading && !visible && offers.length === 0) {
    return null;
  }

  // Loading inicial: no mostrar nada
  if (loading && offers.length === 0) {
    return null;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-brand-ink flex items-center gap-2">
          <ArrowRightLeft className="w-5 h-5 text-brand-gold-dark" />
          Marketplace de Turnos
        </h2>
        <button
          type="button"
          onClick={loadOffers}
          disabled={loading}
          className="text-xs text-brand-navy hover:underline flex items-center gap-1 disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          Actualizar
        </button>
      </div>

      {error && (
        <div className="mb-3 text-xs text-state-danger">{error}</div>
      )}

      {offers.length === 0 && !loading && (
        <div className="bg-white rounded-xl shadow-elevation-1 p-4 text-center text-sm text-gray-400 mb-4">
          <Calendar className="w-5 h-5 mx-auto mb-1 opacity-40" />
          No hay turnos disponibles en el marketplace.
        </div>
      )}

      <div className="space-y-2 mb-4">
        {offers.map((offer) => (
          <div
            key={offer.id}
            className="bg-white rounded-xl shadow-elevation-1 p-4"
          >
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="font-medium text-brand-ink text-sm">
                  {formatDate(offer.shift_date, locale)}
                </p>
                <p className="text-xs text-gray-500">
                  {offer.start_time} – {offer.end_time} · Zona {offer.zone}
                </p>
              </div>
              <span className="text-sm font-semibold text-brand-navy">
                {formatPay(offer.estimated_pay_cents)}
              </span>
            </div>

            {offer.note && (
              <p className="text-xs text-gray-400 italic mb-2">
                &ldquo;{offer.note}&rdquo;
              </p>
            )}

            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">
                {offer.original_employee_name
                  ? `Publicado por ${offer.original_employee_name}`
                  : "Publicado por administración"}
              </span>
              {offer.status === "open" && !offeringIds.has(offer.id) && (
                <button
                  type="button"
                  onClick={() => handleOfferToCover(offer.id)}
                  disabled={offeringId === offer.id}
                  className="bg-brand-navy text-white text-xs px-3 py-1.5 rounded-lg font-medium hover:bg-brand-navy-light transition-colors disabled:opacity-50 flex items-center gap-1"
                >
                  {offeringId === offer.id && (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  )}
                  Cubrir turno
                </button>
              )}
              {(offer.status === "offer_submitted" ||
                offeringIds.has(offer.id)) && (
                <span className="text-xs text-state-success font-medium flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Oferta enviada
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { QuoteData } from "@/types";
import { SERVICE_TYPES } from "@/lib/pricing";
import { DollarSign, Percent, MapPin, Truck, Receipt, Shield, AlertTriangle, Tag, Plus } from "lucide-react";

interface PriceBreakdownProps {
  quote: QuoteData;
}

export function PriceBreakdown({ quote }: PriceBreakdownProps) {
  const t = useTranslations("cotizador.priceBreakdown");
  const serviceKey = SERVICE_TYPES.find((s) => s.key === quote.serviceType)?.key;
  const serviceLabel = serviceKey ? t(`serviceTypes.${serviceKey}`) : quote.serviceType;

  return (
    <div className="bg-brand-ice rounded-lg p-6 space-y-4">
      <h3 className="font-semibold text-brand-ink flex items-center gap-2">
        <Receipt className="w-5 h-5 text-brand-wave-blue" />
        {t("title")}
      </h3>

      {/* Service base */}
      <div className="flex justify-between items-center py-2 border-b border-gray-200">
        <span className="text-gray-600">
          {serviceLabel} ({quote.squareFeet.toLocaleString()} ft²)
        </span>
        <span className="font-medium">${quote.basePrice.toFixed(2)}</span>
      </div>

      {/* Organic adjustment */}
      {quote.organicAdjustment !== 0 && (
        <div className="flex justify-between items-center py-2 border-b border-gray-200">
          <span className="text-gray-600 flex items-center gap-1">
            <Percent className="w-4 h-4" />
            {quote.organicAdjustment > 0 ? t("organicHeavy") : t("organicLight")}
          </span>
          <span className={`font-medium ${quote.organicAdjustment > 0 ? "text-state-warning" : "text-state-success"}`}>
            {quote.organicAdjustment > 0 ? "+" : "-"}${Math.abs(quote.organicAdjustment).toFixed(2)}
          </span>
        </div>
      )}

      {/* Recency adjustment */}
      {quote.recencyAdjustment !== 0 && (
        <div className="flex justify-between items-center py-2 border-b border-gray-200">
          <span className="text-gray-600 flex items-center gap-1">
            <Percent className="w-4 h-4" />
            {quote.recencyAdjustment > 0 ? t("recencyLong") : t("recencyRecent")}
          </span>
          <span className={`font-medium ${quote.recencyAdjustment > 0 ? "text-state-warning" : "text-state-success"}`}>
            {quote.recencyAdjustment > 0 ? "+" : "-"}${Math.abs(quote.recencyAdjustment).toFixed(2)}
          </span>
        </div>
      )}

      {/* Zone surcharge */}
      {quote.zoneSurcharge > 0 && (
        <div className="flex justify-between items-center py-2 border-b border-gray-200">
          <span className="text-gray-600 flex items-center gap-1">
            <MapPin className="w-4 h-4" />
            {t("zoneSurcharge")}
          </span>
          <span className="font-medium text-state-warning">
            +${quote.zoneSurcharge.toFixed(2)}
          </span>
        </div>
      )}

      {/* Logistics surcharge */}
      {quote.logisticsSurcharge > 0 && (
        <div className="flex justify-between items-center py-2 border-b border-gray-200">
          <span className="text-gray-600 flex items-center gap-1">
            <Truck className="w-4 h-4" />
            {t("logisticsSurcharge")}
          </span>
          <span className="font-medium text-state-warning">
            +${quote.logisticsSurcharge.toFixed(2)}
          </span>
        </div>
      )}

      {/* v8.3 E4 (D.7): recargo de zonas add-on (ej. Garaje) seleccionadas por el cliente */}
      {quote.addonZonesCharge > 0 && (
        <div className="flex justify-between items-center py-2 border-b border-gray-200">
          <span className="text-gray-600 flex items-center gap-1">
            <Plus className="w-4 h-4" />
            {t("extraAreas")}
          </span>
          <span className="font-medium text-state-warning">
            +${quote.addonZonesCharge.toFixed(2)}
          </span>
        </div>
      )}

      {/* Rule adjustments
          Fix (2026-07-25, auditoría UX): antes esto mostraba una sola línea
          agregada "Pricing rule adjustment" con la suma de TODAS las reglas
          aplicadas, sin decir cuáles -- mientras que ReservationSummary
          (pantalla de /reserva, un paso después con la MISMA quote) ya
          itemizaba cada regla de quote.appliedRules por nombre. Un cliente
          podía ver un desglose distinto en /cotizador vs /reserva para el
          mismo total. Se itemiza aquí igual que en ReservationSummary, con
          fallback a la línea agregada solo si por alguna razón hay un
          ruleAdjustment distinto de cero sin reglas nombradas (no debería
          pasar en operación normal, pero evita perder el monto si ocurre). */}
      {quote.appliedRules.length > 0
        ? quote.appliedRules
            .filter((rule) => rule.adjustment)
            .map((rule, i) => (
              <div key={i} className="flex justify-between items-center py-2 border-b border-gray-200">
                <span className="text-gray-600 flex items-center gap-1">
                  <Tag className="w-4 h-4" />
                  {rule.name}
                </span>
                <span className={`font-medium ${rule.adjustment > 0 ? "text-state-warning" : "text-state-success"}`}>
                  {rule.adjustment > 0 ? "+" : "-"}${Math.abs(rule.adjustment).toFixed(2)}
                </span>
              </div>
            ))
        : quote.ruleAdjustment !== 0 && (
            <div className="flex justify-between items-center py-2 border-b border-gray-200">
              <span className="text-gray-600 flex items-center gap-1">
                <Tag className="w-4 h-4" />
                {t("ruleAdjustment")}
              </span>
              <span className={`font-medium ${quote.ruleAdjustment > 0 ? "text-state-warning" : "text-state-success"}`}>
                {quote.ruleAdjustment > 0 ? "+" : "-"}${Math.abs(quote.ruleAdjustment).toFixed(2)}
              </span>
            </div>
          )}

      {/* Rule note */}
      {quote.appliedRules.length === 0 && (
        <p className="text-xs text-gray-500">
          {t("ruleNote")}
        </p>
      )}

      {/* Admin review warning */}
      {quote.adminReviewRequired && (
        <div className="flex items-start gap-3 p-3 bg-state-danger/10 rounded-lg">
          <AlertTriangle className="w-5 h-5 text-state-danger flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-state-danger">{t("adminReviewTitle")}</p>
            <p className="text-xs text-gray-600 mt-1">
              {t("adminReviewDesc")}
            </p>
          </div>
        </div>
      )}

      {/* Subtotal */}
      <div className="flex justify-between items-center py-2 border-b-2 border-brand-navy">
        <span className="font-semibold text-brand-ink">{t("subtotal")}</span>
        <span className="font-semibold text-brand-ink">
          ${quote.subtotal.toFixed(2)}
        </span>
      </div>

      {/* Taxes */}
      <div className="flex justify-between items-center py-1">
        <span className="text-gray-500 text-sm">{t("gst")}</span>
        <span className="text-gray-500 text-sm">${quote.gst.toFixed(2)}</span>
      </div>
      <div className="flex justify-between items-center py-1">
        <span className="text-gray-500 text-sm">{t("pst")}</span>
        <span className="text-gray-500 text-sm">${quote.pst.toFixed(2)}</span>
      </div>

      {/* Total */}
      <div className="flex justify-between items-center py-3 bg-brand-navy text-white rounded-lg px-4">
        <span className="font-semibold flex items-center gap-2">
          <DollarSign className="w-5 h-5" />
          {t("total")}
        </span>
        <span className="text-2xl font-bold">${quote.total.toFixed(2)}</span>
      </div>

      {/* Hold */}
      <div className="flex items-start gap-3 p-4 bg-state-warning/10 rounded-lg">
        <Shield className="w-5 h-5 text-state-warning flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-state-warning">
            {t("holdTitle", { amount: `$${quote.holdAmount.toFixed(2)}` })}
          </p>
          <p className="text-xs text-gray-600 mt-1">
            {t("holdDesc")}
          </p>
        </div>
      </div>
    </div>
  );
}

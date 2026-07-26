"use client";

import React from "react";
import { useTranslations, useLocale } from "next-intl";
import { QuoteData } from "@/types";
import { SERVICE_TYPES } from "@/lib/pricing";
import { DollarSign, Percent, MapPin, Truck, Receipt, Shield, AlertTriangle, Tag, Plus } from "lucide-react";
import { formatCurrency } from "@/lib/format";

interface PriceBreakdownProps {
  quote: QuoteData;
}

export function PriceBreakdown({ quote }: PriceBreakdownProps) {
  const t = useTranslations("cotizador.priceBreakdown");
  // Fix (auditoría UX 2026-07-25): antes cada precio se formateaba a mano con
  // `${n.toFixed(2)}` -- siempre en formato inglés-canadiense sin importar el
  // idioma del cliente. Se usa el helper de moneda localizada compartido
  // (src/lib/format.ts) en todo el desglose.
  const locale = useLocale();
  const fmt = (n: number) => formatCurrency(n, locale);
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
        <span className="font-medium">{fmt(quote.basePrice)}</span>
      </div>

      {/* Organic adjustment */}
      {quote.organicAdjustment !== 0 && (
        <div className="flex justify-between items-center py-2 border-b border-gray-200">
          <span className="text-gray-600 flex items-center gap-1">
            <Percent className="w-4 h-4" />
            {quote.organicAdjustment > 0 ? t("organicHeavy") : t("organicLight")}
          </span>
          <span className={`font-medium ${quote.organicAdjustment > 0 ? "text-state-warning" : "text-state-success"}`}>
            {quote.organicAdjustment > 0 ? "+" : "-"}{fmt(Math.abs(quote.organicAdjustment))}
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
            {quote.recencyAdjustment > 0 ? "+" : "-"}{fmt(Math.abs(quote.recencyAdjustment))}
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
            +{fmt(quote.zoneSurcharge)}
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
            +{fmt(quote.logisticsSurcharge)}
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
            +{fmt(quote.addonZonesCharge)}
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
                  {rule.adjustment > 0 ? "+" : "-"}{fmt(Math.abs(rule.adjustment))}
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
                {quote.ruleAdjustment > 0 ? "+" : "-"}{fmt(Math.abs(quote.ruleAdjustment))}
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
          {fmt(quote.subtotal)}
        </span>
      </div>

      {/* Taxes */}
      <div className="flex justify-between items-center py-1">
        <span className="text-gray-500 text-sm">{t("gst")}</span>
        <span className="text-gray-500 text-sm">{fmt(quote.gst)}</span>
      </div>
      <div className="flex justify-between items-center py-1">
        <span className="text-gray-500 text-sm">{t("pst")}</span>
        <span className="text-gray-500 text-sm">{fmt(quote.pst)}</span>
      </div>

      {/* Total */}
      <div className="flex justify-between items-center py-3 bg-brand-navy text-white rounded-lg px-4">
        <span className="font-semibold flex items-center gap-2">
          <DollarSign className="w-5 h-5" />
          {t("total")}
        </span>
        <span className="text-2xl font-bold">{fmt(quote.total)}</span>
      </div>

      {/* Hold */}
      <div className="flex items-start gap-3 p-4 bg-state-warning/10 rounded-lg">
        <Shield className="w-5 h-5 text-state-warning flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-state-warning">
            {t("holdTitle", { amount: fmt(quote.holdAmount) })}
          </p>
          <p className="text-xs text-gray-600 mt-1">
            {t("holdDesc")}
          </p>
        </div>
      </div>
    </div>
  );
}

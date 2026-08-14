"use client";

import React from "react";
import { useTranslations, useLocale } from "next-intl";
import { QuoteData } from "@/types";
import { MapPin, Home, Calendar, DollarSign, Shield, Tag, PlusCircle } from "lucide-react";
import { formatServiceDateDisplay, formatServiceTimeDisplay } from "@/lib/date-utils";
import { formatCurrency as formatCurrencyLocalized } from "@/lib/format";

interface ReservationSummaryProps {
  quote: QuoteData;
  serviceDate?: string;
  serviceTime?: string;
}

interface PriceLine {
  label: string;
  amount: number; // negative = discount, positive = surcharge
}

export function ReservationSummary({
  quote,
  serviceDate,
  serviceTime,
}: ReservationSummaryProps) {
  const t = useTranslations("reserva.summary");
  const locale = useLocale();
  // Fix (auditoría UX 2026-07-25): antes esto formateaba SIEMPRE en "en-CA",
  // sin importar el idioma que el cliente estaba viendo. formatCurrency de
  // src/lib/format.ts usa el locale actual (en/fr/zh) para el formato de
  // separadores/decimales, aunque la moneda siga siendo siempre CAD.
  const formatCurrency = (n: number) => formatCurrencyLocalized(n, locale);

  const subtypeLabel =
    quote.serviceSubtype
      ?.replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase()) ?? t("defaultServiceLabel");

  // v8.3: desglose itemizado en vez de un solo "ruleAdjustment" -- el
  // cliente ve exactamente qué compone el subtotal, igual que
  // "$285 -> $260, ahorraste $25" en vez de un número sin explicar.
  const lines: PriceLine[] = [];
  if (quote.organicAdjustment) lines.push({ label: t("lineLabels.organicProducts"), amount: quote.organicAdjustment });
  if (quote.recencyAdjustment) lines.push({ label: t("lineLabels.recencyAdjustment"), amount: quote.recencyAdjustment });
  if (quote.zoneSurcharge) lines.push({ label: t("lineLabels.zoneSurcharge"), amount: quote.zoneSurcharge });
  if (quote.logisticsSurcharge) lines.push({ label: t("lineLabels.logisticsSurcharge"), amount: quote.logisticsSurcharge });
  if (quote.addonZonesCharge) lines.push({ label: t("lineLabels.additionalZones"), amount: quote.addonZonesCharge });
  for (const rule of quote.appliedRules || []) {
    if (rule.adjustment) lines.push({ label: rule.name, amount: rule.adjustment });
  }

  const totalSavings = lines
    .filter((l) => l.amount < 0)
    .reduce((sum, l) => sum + Math.abs(l.amount), 0);
  const totalSurcharges = lines
    .filter((l) => l.amount > 0)
    .reduce((sum, l) => sum + l.amount, 0);

  return (
    <div className="bg-brand-ice rounded-lg p-5 space-y-4">
      <h3 className="font-semibold text-brand-ink flex items-center gap-2">
        <Shield className="w-5 h-5 text-brand-gold-dark" />
        {t("title")}
      </h3>

      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2 text-gray-600">
          <Home className="w-4 h-4" />
          <span className="capitalize">{subtypeLabel}</span>
          <span className="text-gray-400">·</span>
          <span>
            {t("spaceDetails", {
              bedrooms: quote.bedrooms,
              bathrooms: quote.bathrooms,
              squareFeet: quote.squareFeet,
            })}
          </span>
        </div>

        <div className="flex items-center gap-2 text-gray-600">
          <MapPin className="w-4 h-4" />
          <span>{quote.address}</span>
          <span className="text-gray-400">·</span>
          <span>{quote.zone}</span>
        </div>

        {serviceDate && serviceTime && (
          <div className="flex items-center gap-2 text-gray-600">
            <Calendar className="w-4 h-4" />
            <span>
              {t("dateAtTime", { date: formatServiceDateDisplay(serviceDate, locale), time: formatServiceTimeDisplay(serviceTime, locale) })}
            </span>
          </div>
        )}
      </div>

      <div className="border-t border-gray-200 pt-3 space-y-1 text-sm">
        <div className="flex justify-between text-gray-600">
          <span>{t("basePrice")}</span>
          <span>{formatCurrency(quote.basePrice)}</span>
        </div>

        {lines.map((line, i) => (
          <div key={i} className="flex justify-between">
            <span className="text-gray-600">{line.label}</span>
            <span className={line.amount < 0 ? "text-state-success" : "text-state-warning"}>
              {line.amount < 0 ? "-" : "+"}
              {formatCurrency(Math.abs(line.amount))}
            </span>
          </div>
        ))}

        <div className="flex justify-between font-medium pt-1 border-t border-gray-200">
          <span className="text-gray-700">{t("subtotal")}</span>
          <span>{formatCurrency(quote.subtotal)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">{t("gst")}</span>
          <span>{formatCurrency(quote.gst)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">{t("pst")}</span>
          <span>{formatCurrency(quote.pst)}</span>
        </div>
        <div className="flex justify-between font-semibold text-brand-ink pt-1 border-t border-gray-200">
          <span>{t("total")}</span>
          <span>{formatCurrency(quote.total)}</span>
        </div>
      </div>

      {totalSavings > 0 && (
        <div className="flex items-center gap-2 text-sm text-state-success bg-state-success/10 rounded-lg px-3 py-2">
          <Tag className="w-4 h-4 flex-shrink-0" />
          <span>{t("savingsMessage", { amount: formatCurrency(totalSavings) })}</span>
        </div>
      )}
      {totalSurcharges > 0 && (
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <PlusCircle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>{t("surchargesIncludedMessage", { amount: formatCurrency(totalSurcharges) })}</span>
        </div>
      )}

      <div className="bg-white rounded-lg p-3 border border-brand-gold/30">
        <div className="flex items-center gap-2 text-sm">
          <DollarSign className="w-4 h-4 text-brand-gold-dark" />
          <span className="text-gray-600">{t("securityHoldLabel")}</span>
          <span className="font-semibold text-brand-ink">
            {formatCurrency(quote.holdAmount)}
          </span>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          {t("securityHoldNote")}
        </p>
      </div>
    </div>
  );
}

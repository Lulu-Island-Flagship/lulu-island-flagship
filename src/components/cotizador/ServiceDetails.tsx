"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { QuoteData } from "@/types";
import { Home, MapPin, Users } from "lucide-react";

interface ServiceDetailsProps {
  quote: QuoteData;
}

export function ServiceDetails({ quote }: ServiceDetailsProps) {
  const t = useTranslations("cotizador.serviceDetails");

  const subtypeLabel =
    quote.serviceSubtype
      ?.replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase()) ?? quote.serviceType ?? "";

  const petLabel = quote.petsCount > 0
    ? t("petsLine", { count: quote.petsCount, type: t(`petTypes.${quote.petsType}`) })
    : t("noPets");

  return (
    <div className="bg-brand-ice rounded-lg p-5 space-y-3">
      <h3 className="font-semibold text-brand-ink flex items-center gap-2 text-sm">
        <Home className="w-4 h-4 text-brand-wave-blue" />
        {t("title")}
      </h3>

      {/* Address */}
      <div className="flex items-start gap-2 text-sm text-gray-600">
        <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0 text-gray-400" />
        <span>{quote.address}{quote.postalCode ? `, ${quote.postalCode}` : ""}</span>
        {quote.zone && (
          <span className="text-gray-400 text-xs ml-1">· {quote.zone}</span>
        )}
      </div>

      {/* Service type + space */}
      <div className="flex items-center gap-2 text-sm text-gray-600">
        <Home className="w-4 h-4 flex-shrink-0 text-gray-400" />
        <span>
          {subtypeLabel}
          {" · "}
          {t("spaceDetails", {
            bedrooms: quote.bedrooms,
            bathrooms: quote.bathrooms,
            squareFeet: quote.squareFeet,
          })}
        </span>
      </div>

      {/* Organic load */}
      <div className="flex items-center gap-2 text-sm text-gray-600">
        <Users className="w-4 h-4 flex-shrink-0 text-gray-400" />
        <span>
          {petLabel}
          {quote.residents > 0 && (
            <>
              {" · "}
              {t("residentsLine", { count: quote.residents })}
            </>
          )}
          {" · "}
          {t("daysLine", { days: quote.daysSinceCleaning })}
        </span>
      </div>

      {/* Add-on zones if any */}
      {quote.addonZones && quote.addonZones.length > 0 && (
        <div className="text-xs text-gray-500 pl-6">
          {t("addonZonesLabel")}: {quote.addonZones.join(", ")}
        </div>
      )}
    </div>
  );
}

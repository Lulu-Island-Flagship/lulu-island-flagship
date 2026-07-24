"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Compass } from "lucide-react";
import { ACQUISITION_CHANNELS, type AcquisitionChannel } from "@/lib/acquisition-channel";

interface AcquisitionChannelSelectProps {
  value: AcquisitionChannel | "";
  onChange: (channel: AcquisitionChannel) => void;
}

/**
 * v8.3 E10 (D.10.2): "campo obligatorio '¿Cómo nos conociste?'" — alimenta
 * CAC/LTV por canal (src/lib/attribution.ts). Sin esto, el sistema nunca
 * sabía cómo un cliente llegó a la cotización.
 */
export function AcquisitionChannelSelect({ value, onChange }: AcquisitionChannelSelectProps) {
  const t = useTranslations("cotizador.acquisitionChannel");
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Compass className="w-4 h-4 text-brand-wave-blue" />
        <h3 className="font-semibold text-brand-ink text-sm">{t("title")}</h3>
      </div>
      <select
        aria-label={t("ariaLabel")}
        value={value}
        onChange={(e) => onChange(e.target.value as AcquisitionChannel)}
        className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold text-sm"
        required
      >
        <option value="" disabled>
          {t("selectOne")}
        </option>
        {ACQUISITION_CHANNELS.map((c) => (
          <option key={c} value={c}>
            {t(`channels.${c}`)}
          </option>
        ))}
      </select>
    </div>
  );
}

"use client";

import React, { useEffect, useState, useRef } from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2, Plus } from "lucide-react";

/**
 * v8.3 E4 (D.7): "agregar zona = nombre + peso + tiempo estimado, y aparece
 * automáticamente en cotización, reparto y checklist". Este paso solo
 * muestra zonas que el admin marcó explícitamente como add-on
 * (sop_checklists.is_addon_zone=true) para el service_subtype elegido — las
 * zonas base (cocina, baño, sala...) ya están en el precio y nunca
 * aparecen aquí. Si no hay ninguna zona add-on configurada, el paso no
 * renderiza nada (el wizard lo salta).
 *
 * Fix (2026-07-24): ese "el wizard lo salta" nunca estaba implementado --
 * page.tsx solo hacía stepIndex+1/-1 sin ningún chequeo, así que un cliente
 * cuyo service_subtype no tiene zonas add-on configuradas se topaba con un
 * paso completo cuyo único contenido era "Nothing extra needed", sin poder
 * agregar nada de verdad y sin saber si eso era normal o un error. Ahora
 * este componente avisa al padre vía onEmpty cuando la carga termina sin
 * zonas, y page.tsx salta el paso en la misma dirección en la que se venía
 * navegando.
 */

interface AddonZoneOption {
  zone: string;
  zoneLabel: string;
  timeHours: number;
}

interface StepAddonZonesProps {
  serviceSubtype?: string;
  targetHourlyRate: number;
  selected: string[];
  onChange: (zones: string[]) => void;
  /** Se llama una sola vez, tras confirmar que no hay zonas add-on para este service_subtype. */
  onEmpty?: () => void;
}

export function StepAddonZones({ serviceSubtype, targetHourlyRate, selected, onChange, onEmpty }: StepAddonZonesProps) {
  const t = useTranslations("cotizador.addonZones");
  const [options, setOptions] = useState<AddonZoneOption[]>([]);
  const [loading, setLoading] = useState(true);
  const onEmptyRef = useRef(onEmpty);
  useEffect(() => {
    onEmptyRef.current = onEmpty;
  }, [onEmpty]);

  useEffect(() => {
    if (!serviceSubtype) {
      setOptions([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/quote/addon-zones?serviceSubtype=${encodeURIComponent(serviceSubtype)}`)
      .then((res) => (res.ok ? res.json() : { zones: [] }))
      .then((data) => {
        if (cancelled) return;
        const zones = data.zones || [];
        setOptions(zones);
        if (zones.length === 0) onEmptyRef.current?.();
      })
      .catch(() => {
        if (!cancelled) setOptions([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [serviceSubtype]);

  const toggle = (zone: string) => {
    if (selected.includes(zone)) {
      onChange(selected.filter((z) => z !== zone));
    } else {
      onChange([...selected, zone]);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-brand-gold-dark" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-brand-ink mb-2">{t("title")}</h2>
        <p className="text-gray-600">{t("subtitle")}</p>
      </div>

      {options.length === 0 ? (
        <p className="text-center text-gray-500 text-sm">{t("empty")}</p>
      ) : (
        <div className="space-y-3">
          {options.map((opt) => {
            const isSelected = selected.includes(opt.zone);
            const price = Math.round(opt.timeHours * targetHourlyRate);
            return (
              <button
                key={opt.zone}
                type="button"
                onClick={() => toggle(opt.zone)}
                className={`w-full flex items-center justify-between rounded-lg border p-4 text-left transition-colors ${
                  isSelected
                    ? "border-brand-gold bg-brand-gold/5"
                    : "border-gray-200 bg-brand-ice hover:border-brand-wave-blue"
                }`}
              >
                <div>
                  <p className="font-semibold text-brand-ink">{opt.zoneLabel}</p>
                  <p className="text-sm text-gray-500">+{opt.timeHours}h · +${price}</p>
                </div>
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                    isSelected ? "bg-brand-navy text-white" : "bg-white border border-gray-300 text-gray-400"
                  }`}
                >
                  {isSelected ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

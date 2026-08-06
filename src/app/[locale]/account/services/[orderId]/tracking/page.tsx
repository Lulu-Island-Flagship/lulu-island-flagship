"use client";

import React, { useCallback,  useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, MapPin, Clock, Truck } from "lucide-react";
import { toIntlLocale } from "@/lib/format";

interface TrackingData {
  lat?: number;
  lng?: number;
  lastUpdatedAt?: string;
  emptyReason?: "not_trackable" | "too_early" | "expired" | "no_assignment" | "no_vehicle" | "no_location_yet";
  message?: string;
  visibleFrom?: string;
}

/**
 * v8.3 E3 fix — Tracking de vehículo cliente-facing.
 *
 * Consume /api/client/orders/[orderId]/vehicle-tracking, que solo devuelve
 * lat/lng del VEHÍCULO (nunca identidad del empleado, invariante B.2.17) y
 * solo dentro de los 30 minutos previos al servicio agendado.
 */
export default function ServiceTrackingPage() {
  const t = useTranslations("cuenta.servicios.tracking");
  const params = useParams();
  const orderId = params?.orderId as string;
  const rawLocale = params?.locale as string | undefined;
  const safeLocale = rawLocale && ["en", "zh", "fr"].includes(rawLocale) ? rawLocale : "en";
  const [data, setData] = useState<TrackingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");


  const load = useCallback(async (signal?: AbortSignal) => {
    setError("");
    try {
      const res = await fetch(`/api/client/orders/${orderId}/vehicle-tracking`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("loadFailed"));
        return;
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      // Fix (auditoría frontend 2026-08-01, item 6): el intervalo de 30s se
      // cancela al desmontar -- AbortError es la cancelación esperada, no un
      // error de red real, no se muestra al usuario.
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(t("networkError"));
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [orderId, t]);

  useEffect(() => {
    if (!orderId) return;
    const controller = new AbortController();
    load(controller.signal);
    const interval = setInterval(() => load(controller.signal), 30000);
    return () => {
      clearInterval(interval);
      controller.abort();
    };
  }, [load, orderId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
      </div>
    );
  }

  if (error) {
    return <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>;
  }

  if (!data) return null;

  // Fix (auditoría 2026-07-31, hallazgo #8): `!data.lat || !data.lng` trata
  // el número 0 como "faltante" -- 0,0 es una coordenada real (Golfo de
  // Guinea) y, más relevante para BC, `0` es el tipo de valor falsy de JS
  // que un backend con un bug de geocodificación podría llegar a devolver
  // por error; lo correcto es distinguir "no vino el dato" (null/undefined)
  // de "vino el número 0". Se compara explícitamente contra null/undefined.
  if (data.emptyReason || data.lat == null || data.lng == null) {
    return (
      <div className="max-w-2xl">
        <div className="bg-white rounded-xl border p-8 text-center space-y-2">
          <Clock className="w-10 h-10 text-gray-300 mx-auto" />
          <p className="text-sm text-gray-600">
            {data.message || t("notAvailable")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-brand-ink flex items-center gap-2">
          <Truck className="w-6 h-6 text-brand-navy" /> {t("title")}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {t("subtitle")}
        </p>
      </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        {/* Fix (2026-07-25, auditoría UX): antes esta tarjeta solo mostraba
            "49.28270, -123.12070" como texto plano -- un cliente promedio no
            puede ubicarse a partir de coordenadas crudas. El proyecto no usa
            ninguna librería de mapas (no hay leaflet/mapbox/@react-google-maps
            en package.json, solo `src/adapters/maps.ts`, que envuelve
            geocodificación server-side, no renderizado de mapas), así que
            agregar una librería completa (y su API key, billing, etc.) queda
            fuera de alcance de este pase. En su lugar se embebe un iframe de
            Google Maps vía el parámetro público `output=embed` (no requiere
            API key ni facturación, a diferencia del Maps Embed API oficial)
            -- el cliente ve un mapa real navegable en vez de números, y el
            link "Open in Google Maps" se conserva como respaldo/acción
            explícita para abrir la app nativa. */}
        <iframe
          title={t("mapFrameTitle")}
          className="w-full h-64 border-0"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          src={`https://www.google.com/maps?q=${data.lat},${data.lng}&z=15&output=embed`}
        />
        <div className="p-4 space-y-2">
          <div className="flex items-center gap-2 text-brand-ink">
            <MapPin className="w-5 h-5 text-brand-gold" />
            <span className="text-sm font-medium">
              {data.lat?.toFixed(5)}, {data.lng?.toFixed(5)}
            </span>
          </div>
          {data.lastUpdatedAt && (
            <p className="text-xs text-gray-400">
              {/* Fix (auditoría 2026-07-31, hallazgo #9): toLocaleTimeString()
                  sin argumentos usa el locale/timezone del NAVEGADOR del
                  cliente, no el idioma de la app ni la zona horaria del
                  negocio -- un cliente en /zh viendo la hora en formato
                  inglés, o un cliente fuera de BC viendo una hora que no es
                  la de Vancouver (donde realmente ocurre el servicio). Se fija
                  timeZone "America/Vancouver" (mismo criterio que
                  date-utils.ts) y el locale de la app vía toIntlLocale(). */}
              {t("lastUpdated", {
                time: new Date(data.lastUpdatedAt).toLocaleTimeString(toIntlLocale(safeLocale), {
                  timeZone: "America/Vancouver",
                  hour: "numeric",
                  minute: "2-digit",
                }),
              })}
            </p>
          )}
          <a
            href={`https://www.google.com/maps?q=${data.lat},${data.lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-sm text-brand-navy font-medium underline"
          >
            {t("openInMaps")}
          </a>
        </div>
      </div>
    </div>
  );
}

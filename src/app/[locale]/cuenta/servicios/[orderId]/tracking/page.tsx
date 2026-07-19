"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2, MapPin, Clock, Truck } from "lucide-react";

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
  const params = useParams();
  const orderId = params?.orderId as string;
  const [data, setData] = useState<TrackingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!orderId) return;
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [orderId]);

  async function load() {
    setError("");
    try {
      const res = await fetch(`/api/client/orders/${orderId}/vehicle-tracking`, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to load tracking");
        return;
      }
      const json = await res.json();
      setData(json);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

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

  if (data.emptyReason || !data.lat || !data.lng) {
    return (
      <div className="max-w-2xl">
        <div className="bg-white rounded-xl border p-8 text-center space-y-2">
          <Clock className="w-10 h-10 text-gray-300 mx-auto" />
          <p className="text-sm text-gray-600">
            {data.message || "El tracking en vivo no está disponible en este momento."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-brand-ink flex items-center gap-2">
          <Truck className="w-6 h-6 text-brand-navy" /> Your Team is on the Way
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Live location of your service vehicle — updates automatically.
        </p>
      </div>

      <div className="bg-white rounded-xl border p-6 space-y-3">
        <div className="flex items-center gap-2 text-brand-ink">
          <MapPin className="w-5 h-5 text-brand-gold" />
          <span className="text-sm font-medium">
            {data.lat?.toFixed(5)}, {data.lng?.toFixed(5)}
          </span>
        </div>
        {data.lastUpdatedAt && (
          <p className="text-xs text-gray-400">
            Last updated {new Date(data.lastUpdatedAt).toLocaleTimeString()}
          </p>
        )}
        <a
          href={`https://www.google.com/maps?q=${data.lat},${data.lng}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-sm text-brand-navy font-medium underline"
        >
          Open in Maps
        </a>
      </div>
    </div>
  );
}

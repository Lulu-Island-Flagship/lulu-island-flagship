"use client";

/**
 * v8.3 E9 (D.9.2) — Sugerencias de ajuste de HHE, con aprobación de un clic.
 * Consume /api/admin/hhe-adjustments (GET lista sugerencias, POST aplica UNA).
 * Nunca aplica nada automáticamente — invariante B.3.2.
 */

import React, { useState, useEffect, useCallback } from "react";
import { Gauge, Loader2, CheckCircle2 } from "lucide-react";

interface Suggestion {
  serviceType: string;
  sqftBand: string;
  sqftBandLabel: string;
  currentHhe: number;
  suggestedHhe: number;
  impactPercent: number;
  observationDays: number;
  consistentFraction: number;
  message: string;
}

interface Response {
  suggestions: Suggestion[];
  rangeLabels: string[];
  observationsUsed: number;
}

export default function AjustesHhePage() {
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [applying, setApplying] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/hhe-adjustments");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error cargando sugerencias");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function apply(s: Suggestion) {
    if (!confirm(s.message)) return;
    const key = `${s.serviceType}::${s.sqftBand}`;
    setApplying(key);
    setError("");
    try {
      const res = await fetch("/api/admin/hhe-adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceType: s.serviceType,
          rangeIndex: Number(s.sqftBand),
          suggestedHhe: s.suggestedHhe,
          impactPercent: s.impactPercent,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error aplicando ajuste");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setApplying(null);
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-2 flex items-center gap-3">
        <Gauge className="h-6 w-6 text-brand-navy" />
        <h1 className="text-2xl font-semibold text-brand-navy">Ajustes de HHE sugeridos</h1>
      </div>
      <p className="mb-6 text-sm text-gray-500">
        Desviación sostenida ≥30 días entre HHE estimada y horas-hombre reales (aproximadas desde
        el rango de checklist completado × equipo asignado — no hay clock-in/out dedicado en el
        schema todavía). Aplicar aquí cierra la celda vigente y abre una nueva en la tabla HHE;
        queda registrado y es reversible desde Historial de configuración.
      </p>

      {error && <div className="mb-4 rounded-md border border-state-danger bg-red-50 p-3 text-sm text-state-danger">{error}</div>}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-brand-navy" />
        </div>
      ) : !data || data.suggestions.length === 0 ? (
        <p className="py-16 text-center text-sm text-gray-500">
          Sin desviaciones sostenidas detectadas ({data?.observationsUsed ?? 0} observaciones analizadas).
        </p>
      ) : (
        <div className="space-y-3">
          {data.suggestions.map((s) => {
            const key = `${s.serviceType}::${s.sqftBand}`;
            return (
              <div key={key} className="rounded-lg border border-brand-ice bg-white p-4 shadow-elevation-1">
                <p className="text-sm text-brand-ink">{s.message}</p>
                <p className="mt-1 text-xs text-gray-500">
                  {s.observationDays.toFixed(0)} días de observación, {(s.consistentFraction * 100).toFixed(0)}% consistente
                </p>
                <button
                  onClick={() => apply(s)}
                  disabled={applying === key}
                  className="mt-3 flex items-center gap-1.5 rounded-md bg-brand-navy px-3 py-1.5 text-xs text-white hover:opacity-90 disabled:opacity-50"
                >
                  {applying === key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  Aplicar
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

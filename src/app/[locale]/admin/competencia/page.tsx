"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Swords, Loader2, AlertTriangle } from "lucide-react";

interface Snapshot {
  price_cents: number;
  services: string[];
  active_promotions: string[];
  average_rating: number;
  review_count: number;
  captured_at: string;
  source: "manual_checklist" | "scraping";
}

interface CompetitorRow {
  id: string;
  name: string;
  zone: string;
  notes: string | null;
  latestSnapshot: Snapshot | null;
}

interface Alert {
  id: string;
  competitor_id: string;
  alert_type: string;
  severity: "info" | "warning";
  reason: string;
  created_at: string;
}

interface CompetenciaResponse {
  competitors: CompetitorRow[];
  activeCount: number;
  unacknowledgedAlerts: Alert[];
}

function formatCad(cents: number): string {
  return (cents / 100).toLocaleString("es-CA", { style: "currency", currency: "CAD" });
}

export default function CompetenciaPage() {
  const [data, setData] = useState<CompetenciaResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/competencia");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error cargando inteligencia competitiva");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <Swords className="w-6 h-6" />
        <h1 className="text-2xl font-bold">Inteligencia competitiva</h1>
      </div>

      <p className="text-sm text-gray-500 mb-6">
        Hasta 10 competidores activos (D.10.10). Datos de hoy: checklist manual mensual de E1. Scraping
        automático ⏸️ diferido (requiere revisar TOS de cada sitio antes de automatizar) — cuando se active,
        alimenta esta misma tabla via <code>source = &apos;scraping&apos;</code>, sin romper este panel.
      </p>

      {loading && (
        <div className="flex items-center gap-2 text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Cargando…
        </div>
      )}
      {error && <div className="text-red-600 text-sm mb-4">{error}</div>}

      {data && !loading && (
        <>
          {data.unacknowledgedAlerts.length > 0 && (
            <div className="mb-6 space-y-2">
              {data.unacknowledgedAlerts.map((a) => (
                <div
                  key={a.id}
                  className={`flex items-start gap-2 rounded p-3 text-sm border ${
                    a.severity === "warning" ? "bg-amber-50 border-amber-200" : "bg-blue-50 border-blue-200"
                  }`}
                >
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>{a.reason}</span>
                </div>
              ))}
            </div>
          )}

          <div className="text-xs text-gray-400 mb-3">{data.activeCount} / 10 competidores activos</div>

          <div className="overflow-x-auto rounded border border-gray-200">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left">Competidor</th>
                  <th className="px-3 py-2 text-left">Zona</th>
                  <th className="px-3 py-2 text-right">Precio</th>
                  <th className="px-3 py-2 text-right">Rating</th>
                  <th className="px-3 py-2 text-right">Reseñas</th>
                  <th className="px-3 py-2 text-left">Última captura</th>
                </tr>
              </thead>
              <tbody>
                {data.competitors.map((c) => (
                  <tr key={c.id} className="border-t border-gray-100">
                    <td className="px-3 py-2">{c.name}</td>
                    <td className="px-3 py-2">{c.zone}</td>
                    <td className="px-3 py-2 text-right">
                      {c.latestSnapshot ? formatCad(c.latestSnapshot.price_cents) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">{c.latestSnapshot?.average_rating ?? "—"}</td>
                    <td className="px-3 py-2 text-right">{c.latestSnapshot?.review_count ?? "—"}</td>
                    <td className="px-3 py-2 text-gray-400">
                      {c.latestSnapshot ? new Date(c.latestSnapshot.captured_at).toLocaleDateString("es-CA") : "sin datos"}
                    </td>
                  </tr>
                ))}
                {data.competitors.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-center text-gray-400">
                      Sin competidores registrados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

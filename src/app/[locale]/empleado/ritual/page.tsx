"use client";

import React, { useEffect, useState } from "react";
import { Loader2, Users, CloudSun, Trophy, DollarSign, Award } from "lucide-react";

interface InicioData {
  employeeName: string;
  teammates: { name: string }[];
  conditions: { status: string; condition: string | null; delayMinutes: number | null };
  top3: { teamName: string }[];
}

interface CierreData {
  employeeName: string;
  earnings: { summaryText: string };
  badgeCount: number;
}

export default function ShiftRitualPage() {
  const [inicio, setInicio] = useState<InicioData | null>(null);
  const [cierre, setCierre] = useState<CierreData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      try {
        const [inicioRes, cierreRes] = await Promise.all([
          fetch("/api/empleado/ritual/inicio", { credentials: "include" }),
          fetch("/api/empleado/ritual/cierre", { credentials: "include" }),
        ]);
        if (inicioRes.ok) setInicio(await inicioRes.json());
        if (cierreRes.ok) setCierre(await cierreRes.json());
        if (!inicioRes.ok && !cierreRes.ok) setError("No se pudo cargar");
      } catch {
        setError("Error de red");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-md mx-auto">
      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>}

      <div>
        <h1 className="text-lg font-bold text-brand-ink mb-3">Inicio de jornada</h1>
        <div className="bg-white rounded-xl border p-4 space-y-3">
          <div className="flex items-start gap-2">
            <Users className="w-4 h-4 text-brand-wave-blue shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-brand-ink">Tu equipo hoy</p>
              <p className="text-xs text-gray-500">
                {inicio?.teammates.length ? inicio.teammates.map((t) => t.name).join(", ") : "Sin compañeros asignados hoy."}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <CloudSun className="w-4 h-4 text-brand-gold shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-brand-ink">Clima y tráfico</p>
              <p className="text-xs text-gray-500">
                {inicio?.conditions.status === "ok"
                  ? `${inicio.conditions.condition}${inicio.conditions.delayMinutes ? ` — retraso estimado ${inicio.conditions.delayMinutes} min` : ""}`
                  : "Sin proveedor de clima/tráfico configurado todavía."}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <Trophy className="w-4 h-4 text-brand-gold-dark shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-brand-ink">Top 3 de la semana</p>
              {inicio?.top3.length ? (
                <ol className="text-xs text-gray-500 list-decimal list-inside">
                  {inicio.top3.map((t, i) => (
                    <li key={i}>{t.teamName}</li>
                  ))}
                </ol>
              ) : (
                <p className="text-xs text-gray-500">Sin datos aún esta semana.</p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div>
        <h1 className="text-lg font-bold text-brand-ink mb-3">Fin de jornada</h1>
        <div className="bg-white rounded-xl border p-4 space-y-3">
          <div className="flex items-start gap-2">
            <DollarSign className="w-4 h-4 text-state-success shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-brand-ink">Ganancias de hoy</p>
              <p className="text-xs text-gray-500">{cierre?.earnings.summaryText ?? "—"}</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Award className="w-4 h-4 text-brand-gold shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-brand-ink">Insignias</p>
              <p className="text-xs text-gray-500">{cierre?.badgeCount ?? 0} insignia(s) obtenidas</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

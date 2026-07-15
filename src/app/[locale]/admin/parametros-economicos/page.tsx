"use client";

import React, { useEffect, useState } from "react";
import { Loader2, DollarSign, AlertTriangle, CheckCircle2 } from "lucide-react";

interface Settings {
  id: string;
  bc_min_wage_hourly: number;
  minimum_day_rate: number;
  standard_day_hours: number;
  effective_from: string;
}

interface Impact {
  changed: boolean;
  deltaPerHour: number;
  deltaPercent: number;
  suggestedMinimumDayRate: number;
  dayRateDeltaDollars: number;
}

/**
 * v8.3 E9.6 — Parámetros económicos auto-actualizados (B.3.2).
 * Simular → ver impacto en dólares y contratos afectados → UN clic humano
 * para aplicar (nunca se aplica solo). El backend
 * (src/app/api/admin/economic-params/route.ts) ya existía; esta página
 * cierra el gap de que nadie podía usarlo.
 */
export default function EconomicParamsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [newWage, setNewWage] = useState("");
  const [simulating, setSimulating] = useState(false);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [affectedCount, setAffectedCount] = useState(0);

  const [reason, setReason] = useState("");
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/economic-params", { credentials: "include" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to load");
        return;
      }
      setSettings(data.settings);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function simulate() {
    const wage = parseFloat(newWage);
    if (!wage || wage <= 0) return;
    setSimulating(true);
    setError("");
    setApplied(false);
    try {
      const res = await fetch("/api/admin/economic-params", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ newMinimumWage: wage }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to simulate");
        return;
      }
      setImpact(data.impact);
      setAffectedCount(data.affectedContractsCount || 0);
    } catch {
      setError("Network error");
    } finally {
      setSimulating(false);
    }
  }

  async function apply() {
    if (!settings || !impact || reason.trim().length < 3) return;
    setApplying(true);
    setError("");
    try {
      const res = await fetch("/api/admin/economic-params", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          settingsId: settings.id,
          newMinimumWage: parseFloat(newWage),
          newMinimumDayRate: impact.suggestedMinimumDayRate,
          reason: reason.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to apply");
        return;
      }
      setApplied(true);
      setImpact(null);
      setNewWage("");
      setReason("");
      await load();
    } catch {
      setError("Network error");
    } finally {
      setApplying(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-ink flex items-center gap-2">
          <DollarSign className="w-6 h-6" /> Economic Parameters
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          BC minimum wage / minimum Day Rate. Simulate first, then apply with one click — never auto-applied.
        </p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>}
      {applied && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-700 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" /> Applied successfully.
        </div>
      )}

      {settings && (
        <div className="bg-white rounded-xl border p-5 grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-gray-500">Current BC minimum wage</p>
            <p className="font-semibold text-brand-ink">${Number(settings.bc_min_wage_hourly).toFixed(2)}/hr</p>
          </div>
          <div>
            <p className="text-gray-500">Current minimum Day Rate</p>
            <p className="font-semibold text-brand-ink">${Number(settings.minimum_day_rate).toFixed(2)}</p>
          </div>
          <div>
            <p className="text-gray-500">Standard day hours</p>
            <p className="font-semibold text-brand-ink">{settings.standard_day_hours}h</p>
          </div>
          <div>
            <p className="text-gray-500">Effective from</p>
            <p className="font-semibold text-brand-ink">{settings.effective_from}</p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border p-5 space-y-3">
        <p className="font-medium text-brand-ink text-sm">Simulate a new minimum wage</p>
        <div className="flex items-center gap-2">
          <input
            aria-label="Nuevo salario mínimo a simular"
            type="number"
            step="0.01"
            value={newWage}
            onChange={(e) => setNewWage(e.target.value)}
            placeholder="e.g. 18.65"
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <button
            aria-label="Simular impacto del nuevo salario mínimo"
            onClick={simulate}
            disabled={simulating || !newWage}
            className="bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {simulating ? "Simulating..." : "Simulate"}
          </button>
        </div>

        {impact && (
          <div className="bg-brand-ice rounded-lg p-4 space-y-2 text-sm">
            <div className="flex items-center gap-2 text-brand-ink">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                {impact.deltaPercent >= 0 ? "+" : ""}
                {impact.deltaPercent.toFixed(1)}% per hour ({impact.deltaPerHour >= 0 ? "+" : ""}$
                {impact.deltaPerHour.toFixed(2)})
              </span>
            </div>
            <p>
              Suggested new minimum Day Rate: <strong>${impact.suggestedMinimumDayRate.toFixed(2)}</strong> (
              {impact.dayRateDeltaDollars >= 0 ? "+" : ""}${impact.dayRateDeltaDollars.toFixed(2)})
            </p>
            <p>{affectedCount} active contract(s) below the new floor need adjustment.</p>

            <div className="pt-2 border-t space-y-2">
              <input
                aria-label="Motivo del cambio de salario mínimo"
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason for this change (required, min 3 chars)"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <button
                aria-label="Aplicar cambio de salario mínimo"
                onClick={apply}
                disabled={applying || reason.trim().length < 3}
                className="w-full bg-state-danger text-white py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50"
              >
                {applying ? "Applying..." : "Apply this change (one click, cannot be undone silently)"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import React, { useEffect, useState } from "react";
import { Loader2, TrendingDown, AlertTriangle, CheckCircle2 } from "lucide-react";

interface SimulatedMonth {
  monthIndex: number;
  simulatedRevenueCents: number;
  simulatedNetMarginCents: number;
  isNegative: boolean;
}

interface RunResult {
  months: SimulatedMonth[];
  crossesThreshold: boolean;
  reserveCheck: { meetsRule: boolean; requiredCents: number; shortfallCents: number } | null;
}

const LEVERS = [
  { key: "day_rate_por_bloque", label: "1. Day Rate por bloque" },
  { key: "reactivacion_dormidos", label: "2. Reactivación de clientes dormidos" },
  { key: "pausar_regalos_nuevos", label: "3. Pausar regalos nuevos" },
  { key: "cortar_zonas_no_rentables", label: "4. Cortar zonas no rentables" },
];

function fmt(cents: number) {
  return `$${(cents / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function StressScenarioPage() {
  const [revenue, setRevenue] = useState("");
  const [fixedCosts, setFixedCosts] = useState("");
  const [variableCosts, setVariableCosts] = useState("");
  const [cashOnHand, setCashOnHand] = useState("");
  const [biweeklyPayroll, setBiweeklyPayroll] = useState("");
  const [ownerPresent, setOwnerPresent] = useState(false);
  const [leversDocumented, setLeversDocumented] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  async function runScenario() {
    setRunning(true);
    setError("");
    try {
      const res = await fetch("/api/admin/stress-scenario", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          currentMonthlyRevenueCents: Math.round(Number(revenue) * 100),
          currentMonthlyFixedCostsCents: Math.round(Number(fixedCosts) * 100),
          currentMonthlyVariableCostsCents: Math.round(Number(variableCosts) * 100),
          currentCashOnHandCents: cashOnHand ? Math.round(Number(cashOnHand) * 100) : undefined,
          biweeklyPayrollCents: biweeklyPayroll ? Math.round(Number(biweeklyPayroll) * 100) : undefined,
          ownerPresent,
          leversDocumented,
          notes: notes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to run scenario");
        return;
      }
      setResult(data);
    } catch {
      setError("Network error");
    } finally {
      setRunning(false);
    }
  }

  function toggleLever(key: string) {
    setLeversDocumented((prev) => (prev.includes(key) ? prev.filter((l) => l !== key) : [...prev, key]));
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-ink">Financial Stress Scenario</h1>
        <p className="text-sm text-gray-500 mt-1">
          Simulates -30% revenue for 3 consecutive months (D.11.7). Run it WITH the owner present and document which
          levers apply — the fixed order (Day Rate → dormant reactivation → pause new gifts → cut unprofitable
          zones) is never skipped or reordered.
        </p>
      </div>

      <div className="bg-white rounded-xl border p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Current monthly revenue ($)</label>
            <input value={revenue} onChange={(e) => setRevenue(e.target.value)} type="number" className="border rounded-lg px-3 py-2 text-sm w-full" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Current monthly fixed costs ($)</label>
            <input value={fixedCosts} onChange={(e) => setFixedCosts(e.target.value)} type="number" className="border rounded-lg px-3 py-2 text-sm w-full" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Current monthly variable costs ($)</label>
            <input value={variableCosts} onChange={(e) => setVariableCosts(e.target.value)} type="number" className="border rounded-lg px-3 py-2 text-sm w-full" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Cash on hand ($, optional — for reserve rule)</label>
            <input value={cashOnHand} onChange={(e) => setCashOnHand(e.target.value)} type="number" className="border rounded-lg px-3 py-2 text-sm w-full" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Biweekly payroll ($, optional)</label>
            <input value={biweeklyPayroll} onChange={(e) => setBiweeklyPayroll(e.target.value)} type="number" className="border rounded-lg px-3 py-2 text-sm w-full" />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={ownerPresent} onChange={(e) => setOwnerPresent(e.target.checked)} />
          The owner is present for this run
        </label>

        <div>
          <p className="text-xs text-gray-500 mb-2">Levers documented as plan (in order, don&apos;t skip):</p>
          <div className="space-y-1">
            {LEVERS.map((l) => (
              <label key={l.key} className="flex items-center gap-2 text-sm text-gray-600">
                <input type="checkbox" checked={leversDocumented.includes(l.key)} onChange={() => toggleLever(l.key)} />
                {l.label}
              </label>
            ))}
          </div>
        </div>

        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" className="w-full border rounded-lg px-3 py-2 text-sm" rows={2} />

        {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>}

        <button
          onClick={runScenario}
          disabled={running || !revenue || !fixedCosts || !variableCosts}
          className="inline-flex items-center gap-2 bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <TrendingDown className="w-4 h-4" />}
          Run scenario
        </button>
      </div>

      {result && (
        <div className="bg-white rounded-xl border p-5 space-y-4">
          <h2 className="font-semibold text-brand-ink">Results</h2>
          <div className="grid grid-cols-3 gap-3">
            {result.months.map((m) => (
              <div key={m.monthIndex} className={`rounded-lg p-3 ${m.isNegative ? "bg-red-50" : "bg-green-50"}`}>
                <p className="text-xs text-gray-500">Month {m.monthIndex}</p>
                <p className="text-sm font-semibold text-brand-ink">{fmt(m.simulatedRevenueCents)} revenue</p>
                <p className={`text-sm ${m.isNegative ? "text-state-danger" : "text-state-success"}`}>
                  {fmt(m.simulatedNetMarginCents)} net margin
                </p>
              </div>
            ))}
          </div>

          {result.crossesThreshold ? (
            <div className="bg-red-50 text-state-danger text-sm rounded-lg p-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" /> Crosses the mandatory review threshold (2+ consecutive
              negative months) — a review with the owner is required.
            </div>
          ) : (
            <div className="bg-green-50 text-state-success text-sm rounded-lg p-3 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" /> Does not cross the mandatory review threshold.
            </div>
          )}

          {result.reserveCheck && (
            <div className={`text-sm rounded-lg p-3 ${result.reserveCheck.meetsRule ? "bg-green-50 text-state-success" : "bg-amber-50 text-amber-700"}`}>
              Expansion reserve rule (3 months fixed + 1 biweekly payroll): required {fmt(result.reserveCheck.requiredCents)}.{" "}
              {result.reserveCheck.meetsRule ? "Met." : `Short by ${fmt(result.reserveCheck.shortfallCents)}.`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

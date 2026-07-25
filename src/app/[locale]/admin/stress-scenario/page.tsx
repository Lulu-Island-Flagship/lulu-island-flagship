"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
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
  { key: "day_rate_por_bloque", i18nKey: "dayRatePorBloque" },
  { key: "reactivacion_dormidos", i18nKey: "reactivacionDormidos" },
  { key: "pausar_regalos_nuevos", i18nKey: "pausarRegalosNuevos" },
  { key: "cortar_zonas_no_rentables", i18nKey: "cortarZonasNoRentables" },
];

function fmt(cents: number) {
  return `$${(cents / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function StressScenarioPage() {
  const t = useTranslations("admin.stressScenario");
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
        setError(data.error || t("errors.runFailed"));
        return;
      }
      setResult(data);
    } catch {
      setError(t("errors.network"));
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
        <h1 className="text-2xl font-bold text-brand-ink">{t("title")}</h1>
        <p className="text-sm text-gray-500 mt-1">{t("subtitle")}</p>
      </div>

      <div className="bg-white rounded-xl border p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-gray-500 block mb-1">{t("fields.revenue")}</label>
            <input aria-label={t("fields.revenue")} value={revenue} onChange={(e) => setRevenue(e.target.value)} type="number" className="border rounded-lg px-3 py-2 text-sm w-full" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">{t("fields.fixedCosts")}</label>
            <input aria-label={t("fields.fixedCosts")} value={fixedCosts} onChange={(e) => setFixedCosts(e.target.value)} type="number" className="border rounded-lg px-3 py-2 text-sm w-full" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">{t("fields.variableCosts")}</label>
            <input aria-label={t("fields.variableCosts")} value={variableCosts} onChange={(e) => setVariableCosts(e.target.value)} type="number" className="border rounded-lg px-3 py-2 text-sm w-full" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">{t("fields.cashOnHand")}</label>
            <input aria-label={t("fields.cashOnHand")} value={cashOnHand} onChange={(e) => setCashOnHand(e.target.value)} type="number" className="border rounded-lg px-3 py-2 text-sm w-full" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">{t("fields.biweeklyPayroll")}</label>
            <input aria-label={t("fields.biweeklyPayroll")} value={biweeklyPayroll} onChange={(e) => setBiweeklyPayroll(e.target.value)} type="number" className="border rounded-lg px-3 py-2 text-sm w-full" />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" aria-label={t("ownerPresentLabel")} checked={ownerPresent} onChange={(e) => setOwnerPresent(e.target.checked)} />
          {t("ownerPresentLabel")}
        </label>

        <div>
          <p className="text-xs text-gray-500 mb-2">{t("leversIntro")}</p>
          <div className="space-y-1">
            {LEVERS.map((l) => (
              <label key={l.key} className="flex items-center gap-2 text-sm text-gray-600">
                <input type="checkbox" aria-label={t(`levers.${l.i18nKey}`)} checked={leversDocumented.includes(l.key)} onChange={() => toggleLever(l.key)} />
                {t(`levers.${l.i18nKey}`)}
              </label>
            ))}
          </div>
        </div>

        <textarea aria-label={t("notesAria")} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("notesPlaceholder")} className="w-full border rounded-lg px-3 py-2 text-sm" rows={2} />

        {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>}

        <button
          onClick={runScenario}
          disabled={running || !revenue || !fixedCosts || !variableCosts}
          className="inline-flex items-center gap-2 bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <TrendingDown className="w-4 h-4" />}
          {t("runScenario")}
        </button>
      </div>

      {result && (
        <div className="bg-white rounded-xl border p-5 space-y-4">
          <h2 className="font-semibold text-brand-ink">{t("resultsHeading")}</h2>
          <div className="grid grid-cols-3 gap-3">
            {result.months.map((m) => (
              <div key={m.monthIndex} className={`rounded-lg p-3 ${m.isNegative ? "bg-red-50" : "bg-green-50"}`}>
                <p className="text-xs text-gray-500">{t("monthLabel", { index: m.monthIndex })}</p>
                <p className="text-sm font-semibold text-brand-ink">{t("revenueAmount", { amount: fmt(m.simulatedRevenueCents) })}</p>
                <p className={`text-sm ${m.isNegative ? "text-state-danger" : "text-state-success"}`}>
                  {t("netMarginAmount", { amount: fmt(m.simulatedNetMarginCents) })}
                </p>
              </div>
            ))}
          </div>

          {result.crossesThreshold ? (
            <div className="bg-red-50 text-state-danger text-sm rounded-lg p-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" /> {t("crossesThreshold")}
            </div>
          ) : (
            <div className="bg-green-50 text-state-success text-sm rounded-lg p-3 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" /> {t("doesNotCrossThreshold")}
            </div>
          )}

          {result.reserveCheck && (
            <div className={`text-sm rounded-lg p-3 ${result.reserveCheck.meetsRule ? "bg-green-50 text-state-success" : "bg-amber-50 text-amber-700"}`}>
              {t("reserveRule", { amount: fmt(result.reserveCheck.requiredCents) })}{" "}
              {result.reserveCheck.meetsRule ? t("reserveMet") : t("reserveShortBy", { amount: fmt(result.reserveCheck.shortfallCents) })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

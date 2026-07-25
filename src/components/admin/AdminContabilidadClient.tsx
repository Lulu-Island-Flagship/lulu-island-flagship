"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { DollarSign, Loader2, TrendingUp, TrendingDown, Download, AlertTriangle, CheckCircle2, X } from "lucide-react";

interface GroupSummary {
  key: string;
  orders: number;
  collectedCents: number;
  laborCostCents: number;
  employerBurdenCents: number;
  otherCostsCents: number;
  contributionMarginCents: number;
  contributionMarginPercent: number;
  netMarginCents: number;
  netMarginPercent: number;
}

interface AccountingResponse {
  byZone: GroupSummary[];
  byServiceType: GroupSummary[];
  byTeam: GroupSummary[];
  overall: GroupSummary;
  fixedCostsConfigured: boolean;
  monthlyFixedCostsCents: number;
}

function formatCad(cents: number): string {
  return (cents / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
}

function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

// v8.3 E9.2: "margen <15% por tipo → alerta con sugerencia" — mismo piso
// que MARGIN_FLOOR_PERCENT (src/lib/pricing.ts), duplicado aquí como
// constante local para no importar el módulo completo de pricing (server-
// oriented) en un client component solo por un número.
const MARGIN_ALERT_THRESHOLD = 0.15;

function GroupTable({ title, rows, flagLowMargin }: { title: string; rows: GroupSummary[]; flagLowMargin?: boolean }) {
  const t = useTranslations("admin.contabilidad");
  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold mb-2">{title}</h2>
      <div className="overflow-x-auto rounded border border-gray-200">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-3 py-2 text-left">{t("table.group")}</th>
              <th scope="col" className="px-3 py-2 text-right">{t("table.orders")}</th>
              <th scope="col" className="px-3 py-2 text-right">{t("table.collected")}</th>
              <th scope="col" className="px-3 py-2 text-right">{t("table.paid")}</th>
              <th scope="col" className="px-3 py-2 text-right">{t("table.employerBurden")}</th>
              <th scope="col" className="px-3 py-2 text-right">{t("table.contributionMargin")}</th>
              <th scope="col" className="px-3 py-2 text-right">{t("table.netMargin")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isLowMargin = flagLowMargin && r.contributionMarginPercent < MARGIN_ALERT_THRESHOLD;
              return (
                <tr key={r.key} className={`border-t border-gray-100 ${isLowMargin ? "bg-red-50" : ""}`}>
                  <td className="px-3 py-2 flex items-center gap-1.5">
                    {isLowMargin && <AlertTriangle className="w-3.5 h-3.5 text-state-danger shrink-0" />}
                    {r.key}
                  </td>
                  <td className="px-3 py-2 text-right">{r.orders}</td>
                  <td className="px-3 py-2 text-right">{formatCad(r.collectedCents)}</td>
                  <td className="px-3 py-2 text-right">{formatCad(r.laborCostCents)}</td>
                  <td className="px-3 py-2 text-right">{formatCad(r.employerBurdenCents + r.otherCostsCents)}</td>
                  <td className="px-3 py-2 text-right">
                    <span className={isLowMargin ? "text-state-danger font-medium" : ""}>
                      {formatCad(r.contributionMarginCents)} ({formatPercent(r.contributionMarginPercent)})
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className={r.netMarginCents >= 0 ? "text-green-700" : "text-red-700"}>
                      {formatCad(r.netMarginCents)}
                    </span>{" "}
                    <span className="text-gray-500">({formatPercent(r.netMarginPercent)})</span>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-gray-400">
                  {t("table.noData")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {flagLowMargin && rows.some((r) => r.contributionMarginPercent < MARGIN_ALERT_THRESHOLD) && (
        <p className="text-xs text-state-danger mt-1 flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3" /> {t("table.lowMarginWarning", { threshold: MARGIN_ALERT_THRESHOLD * 100 })}
        </p>
      )}
    </div>
  );
}

function downloadExport(month: string, format: "csv" | "json") {
  const url = `/api/admin/export?month=${encodeURIComponent(month)}&format=${format}`;
  const a = document.createElement("a");
  a.href = url;
  a.download = `export_universal_${month}.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export default function AdminContabilidadClient() {
  const t = useTranslations("admin.contabilidad");
  const [data, setData] = useState<AccountingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [exportMonth, setExportMonth] = useState(() => new Date().toISOString().slice(0, 7));

  const [showFixedCostsForm, setShowFixedCostsForm] = useState(false);
  const [fixedCostsInput, setFixedCostsInput] = useState("");
  const [fixedCostsReason, setFixedCostsReason] = useState("");
  const [savingFixedCosts, setSavingFixedCosts] = useState(false);
  const [fixedCostsError, setFixedCostsError] = useState<string | null>(null);
  const [fixedCostsSuccess, setFixedCostsSuccess] = useState(false);

  async function saveFixedCosts() {
    const dollars = parseFloat(fixedCostsInput);
    if (isNaN(dollars) || dollars < 0 || fixedCostsReason.trim().length === 0) {
      setFixedCostsError(t("fixedCostsForm.invalidInput"));
      return;
    }
    setSavingFixedCosts(true);
    setFixedCostsError(null);
    setFixedCostsSuccess(false);
    try {
      const res = await fetch("/api/admin/fixed-costs-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthlyFixedCostsDollars: dollars, reason: fixedCostsReason.trim() }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setFixedCostsError(json.error || t("fixedCostsForm.saveError"));
        return;
      }
      setShowFixedCostsForm(false);
      setFixedCostsInput("");
      setFixedCostsReason("");
      await load();
      setFixedCostsSuccess(true);
    } catch {
      setFixedCostsError(t("fixedCostsForm.connectionError"));
    } finally {
      setSavingFixedCosts(false);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const res = await fetch(`/api/admin/accounting?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || t("loadError"));
      setData(json);
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : t("loadErrorFull")
      );
    } finally {
      setLoading(false);
    }
  }, [from, to, t]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <DollarSign className="w-6 h-6" />
        <h1 className="text-2xl font-bold">{t("title")}</h1>
      </div>

      <p className="text-sm text-gray-500 mb-4">
        {t("intro")}
      </p>

      <div className="flex items-end gap-3 mb-6">
        <div>
          <label htmlFor="accounting-from" className="block text-xs text-gray-500 mb-1">{t("filters.from")}</label>
          <input id="accounting-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border rounded px-2 py-1 text-sm" />
        </div>
        <div>
          <label htmlFor="accounting-to" className="block text-xs text-gray-500 mb-1">{t("filters.to")}</label>
          <input id="accounting-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border rounded px-2 py-1 text-sm" />
        </div>
        <button onClick={load} className="px-3 py-1.5 bg-gray-900 text-white rounded text-sm">
          {t("filters.filter")}
        </button>
      </div>

      <div className="flex items-end gap-3 mb-6 border-t pt-4">
        <div>
          <label htmlFor="accounting-export-month" className="block text-xs text-gray-500 mb-1">{t("export.label")}</label>
          <input
            id="accounting-export-month"
            type="month"
            value={exportMonth}
            onChange={(e) => setExportMonth(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          />
        </div>
        <button
          onClick={() => downloadExport(exportMonth, "csv")}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-900 rounded text-sm hover:bg-gray-50"
        >
          <Download className="w-3.5 h-3.5" /> {t("export.csv")}
        </button>
        <button
          onClick={() => downloadExport(exportMonth, "json")}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-900 rounded text-sm hover:bg-gray-50"
        >
          <Download className="w-3.5 h-3.5" /> {t("export.json")}
        </button>
        <span className="text-xs text-gray-400">
          {t("export.note")}
        </span>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" /> {t("loading")}
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2 border border-red-200 bg-red-50 rounded p-3 mb-4 text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p>{error}</p>
            <button type="button" onClick={load} className="mt-1 text-xs font-semibold underline">
              {t("retry")}
            </button>
          </div>
        </div>
      )}

      {data && !data.fixedCostsConfigured && (
        <div className="flex items-start gap-2 border border-amber-300 bg-amber-50 rounded p-3 mb-6 text-sm text-amber-800">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="flex-1">
            {t("fixedCostsWarning.text")}
            {!showFixedCostsForm ? (
              <button onClick={() => setShowFixedCostsForm(true)} className="ml-2 underline font-medium">
                {t("fixedCostsWarning.setNow")}
              </button>
            ) : (
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <div>
                  <label htmlFor="fixed-costs-amount" className="block text-xs mb-1">{t("fixedCostsForm.amountLabel")}</label>
                  <input
                    id="fixed-costs-amount"
                    type="number"
                    min="0"
                    step="0.01"
                    value={fixedCostsInput}
                    onChange={(e) => setFixedCostsInput(e.target.value)}
                    className="border rounded px-2 py-1 text-sm w-32"
                  />
                </div>
                <div>
                  <label htmlFor="fixed-costs-reason" className="block text-xs mb-1">{t("fixedCostsForm.reasonLabel")}</label>
                  <input
                    id="fixed-costs-reason"
                    type="text"
                    value={fixedCostsReason}
                    onChange={(e) => setFixedCostsReason(e.target.value)}
                    className="border rounded px-2 py-1 text-sm"
                    placeholder={t("fixedCostsForm.reasonPlaceholder")}
                  />
                </div>
                <button
                  aria-label={t("fixedCostsForm.saveAriaLabel")}
                  onClick={saveFixedCosts}
                  disabled={savingFixedCosts}
                  className="px-3 py-1.5 bg-brand-navy text-white rounded text-sm disabled:opacity-50"
                >
                  {savingFixedCosts ? t("fixedCostsForm.saving") : t("fixedCostsForm.save")}
                </button>
                {fixedCostsError && (
                  <p className="text-xs text-state-danger w-full">{fixedCostsError}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {fixedCostsSuccess && (
        <div className="flex items-center justify-between gap-2 border border-green-200 bg-green-50 rounded p-3 mb-6 text-sm text-green-700">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" /> {t("fixedCostsSuccess")}
          </span>
          <button
            type="button"
            aria-label={t("dismissAriaLabel")}
            onClick={() => setFixedCostsSuccess(false)}
            className="opacity-60 hover:opacity-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {data && !loading && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
            <div className="border rounded p-4">
              <div className="text-xs text-gray-500 mb-1">{t("summary.totalCollected")}</div>
              <div className="text-xl font-semibold">{formatCad(data.overall.collectedCents)}</div>
            </div>
            <div className="border rounded p-4">
              <div className="text-xs text-gray-500 mb-1">{t("summary.netMargin")}</div>
              <div className={`text-xl font-semibold flex items-center gap-1 ${data.overall.netMarginCents >= 0 ? "text-green-700" : "text-red-700"}`}>
                {data.overall.netMarginCents >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                {formatCad(data.overall.netMarginCents)} ({formatPercent(data.overall.netMarginPercent)})
              </div>
            </div>
          </div>

          <GroupTable title={t("tables.byZone")} rows={data.byZone} />
          <GroupTable title={t("tables.byServiceType")} rows={data.byServiceType} flagLowMargin />
          <GroupTable title={t("tables.byTeam")} rows={data.byTeam} />
        </>
      )}
    </div>
  );
}

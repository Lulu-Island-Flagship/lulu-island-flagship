"use client";

import React, { useState, useEffect, useCallback } from "react";
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
  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold mb-2">{title}</h2>
      <div className="overflow-x-auto rounded border border-gray-200">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-3 py-2 text-left">Group</th>
              <th scope="col" className="px-3 py-2 text-right">Orders</th>
              <th scope="col" className="px-3 py-2 text-right">Collected</th>
              <th scope="col" className="px-3 py-2 text-right">Paid (payroll)</th>
              <th scope="col" className="px-3 py-2 text-right">Employer burden</th>
              <th scope="col" className="px-3 py-2 text-right">Contribution margin</th>
              <th scope="col" className="px-3 py-2 text-right">Actual net margin</th>
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
                  No data in the selected range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {flagLowMargin && rows.some((r) => r.contributionMarginPercent < MARGIN_ALERT_THRESHOLD) && (
        <p className="text-xs text-state-danger mt-1 flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3" /> Highlighted service types are below the {MARGIN_ALERT_THRESHOLD * 100}%
          contribution margin floor (D.9.2) — consider a pricing rule adjustment or reviewing SOP time for that
          service.
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
      setFixedCostsError("Enter a valid amount (0 or more) and a reason before saving.");
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
        setFixedCostsError(json.error || "Couldn't save fixed costs. Please check the values and try again.");
        return;
      }
      setShowFixedCostsForm(false);
      setFixedCostsInput("");
      setFixedCostsReason("");
      await load();
      setFixedCostsSuccess(true);
    } catch {
      setFixedCostsError("Connection problem. Check your internet and try again.");
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
      if (!res.ok) throw new Error(json.error || "We couldn't load accounting data.");
      setData(json);
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : "We couldn't load accounting data. Check your connection and try again."
      );
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <DollarSign className="w-6 h-6" />
        <h1 className="text-2xl font-bold">Operational Accounting</h1>
      </div>

      <p className="text-sm text-gray-500 mb-4">
        Collected = actual amount captured from the client. Paid = gross payroll. Contribution margin = collected −
        paid. Actual net margin = collected − paid − employer burden (CPP/EI/WorkSafeBC) − prorated monthly fixed
        costs (rent, insurance, software, owner compensation). Employer burden is shown as 0 until a payroll
        snapshot exists for the corresponding cycle. Fixed costs are prorated across the calendar months actually
        present in the selected range, split evenly per order.
      </p>

      <div className="flex items-end gap-3 mb-6">
        <div>
          <label htmlFor="accounting-from" className="block text-xs text-gray-500 mb-1">From</label>
          <input id="accounting-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border rounded px-2 py-1 text-sm" />
        </div>
        <div>
          <label htmlFor="accounting-to" className="block text-xs text-gray-500 mb-1">To</label>
          <input id="accounting-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border rounded px-2 py-1 text-sm" />
        </div>
        <button onClick={load} className="px-3 py-1.5 bg-gray-900 text-white rounded text-sm">
          Filter
        </button>
      </div>

      <div className="flex items-end gap-3 mb-6 border-t pt-4">
        <div>
          <label htmlFor="accounting-export-month" className="block text-xs text-gray-500 mb-1">Universal export (month)</label>
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
          <Download className="w-3.5 h-3.5" /> CSV
        </button>
        <button
          onClick={() => downloadExport(exportMonth, "json")}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-900 rounded text-sm hover:bg-gray-50"
        >
          <Download className="w-3.5 h-3.5" /> JSON
        </button>
        <span className="text-xs text-gray-400">
          No dependency on QBO — revenue, payroll, commissions, gifts and tax reserves for the month (D.9.5).
        </span>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2 border border-red-200 bg-red-50 rounded p-3 mb-4 text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p>{error}</p>
            <button type="button" onClick={load} className="mt-1 text-xs font-semibold underline">
              Retry
            </button>
          </div>
        </div>
      )}

      {data && !data.fixedCostsConfigured && (
        <div className="flex items-start gap-2 border border-amber-300 bg-amber-50 rounded p-3 mb-6 text-sm text-amber-800">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="flex-1">
            Monthly fixed costs are not configured yet (rent, insurance, software, owner compensation) — actual net
            margin below does not subtract them and is currently equal to contribution margin.
            {!showFixedCostsForm ? (
              <button onClick={() => setShowFixedCostsForm(true)} className="ml-2 underline font-medium">
                Set it now
              </button>
            ) : (
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <div>
                  <label htmlFor="fixed-costs-amount" className="block text-xs mb-1">Monthly fixed costs ($)</label>
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
                  <label htmlFor="fixed-costs-reason" className="block text-xs mb-1">Reason (required)</label>
                  <input
                    id="fixed-costs-reason"
                    type="text"
                    value={fixedCostsReason}
                    onChange={(e) => setFixedCostsReason(e.target.value)}
                    className="border rounded px-2 py-1 text-sm"
                    placeholder="e.g. initial setup with real rent + insurance"
                  />
                </div>
                <button
                  aria-label="Guardar costos fijos"
                  onClick={saveFixedCosts}
                  disabled={savingFixedCosts}
                  className="px-3 py-1.5 bg-brand-navy text-white rounded text-sm disabled:opacity-50"
                >
                  {savingFixedCosts ? "Saving..." : "Save"}
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
            <CheckCircle2 className="w-4 h-4 shrink-0" /> Fixed costs saved.
          </span>
          <button
            type="button"
            aria-label="Dismiss"
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
              <div className="text-xs text-gray-500 mb-1">Total collected</div>
              <div className="text-xl font-semibold">{formatCad(data.overall.collectedCents)}</div>
            </div>
            <div className="border rounded p-4">
              <div className="text-xs text-gray-500 mb-1">Actual net margin</div>
              <div className={`text-xl font-semibold flex items-center gap-1 ${data.overall.netMarginCents >= 0 ? "text-green-700" : "text-red-700"}`}>
                {data.overall.netMarginCents >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                {formatCad(data.overall.netMarginCents)} ({formatPercent(data.overall.netMarginPercent)})
              </div>
            </div>
          </div>

          <GroupTable title="By zone" rows={data.byZone} />
          <GroupTable title="By service type" rows={data.byServiceType} flagLowMargin />
          <GroupTable title="By team" rows={data.byTeam} />
        </>
      )}
    </div>
  );
}

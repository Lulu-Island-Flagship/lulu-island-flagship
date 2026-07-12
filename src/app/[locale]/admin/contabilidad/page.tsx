"use client";

import React, { useState, useEffect, useCallback } from "react";
import { DollarSign, Loader2, TrendingUp, TrendingDown, Download } from "lucide-react";

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
}

function formatCad(cents: number): string {
  return (cents / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
}

function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

function GroupTable({ title, rows }: { title: string; rows: GroupSummary[] }) {
  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold mb-2">{title}</h2>
      <div className="overflow-x-auto rounded border border-gray-200">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left">Group</th>
              <th className="px-3 py-2 text-right">Orders</th>
              <th className="px-3 py-2 text-right">Collected</th>
              <th className="px-3 py-2 text-right">Paid (payroll)</th>
              <th className="px-3 py-2 text-right">Employer burden</th>
              <th className="px-3 py-2 text-right">Contribution margin</th>
              <th className="px-3 py-2 text-right">Actual net margin</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-gray-100">
                <td className="px-3 py-2">{r.key}</td>
                <td className="px-3 py-2 text-right">{r.orders}</td>
                <td className="px-3 py-2 text-right">{formatCad(r.collectedCents)}</td>
                <td className="px-3 py-2 text-right">{formatCad(r.laborCostCents)}</td>
                <td className="px-3 py-2 text-right">{formatCad(r.employerBurdenCents + r.otherCostsCents)}</td>
                <td className="px-3 py-2 text-right">
                  {formatCad(r.contributionMarginCents)}{" "}
                  <span className="text-gray-500">({formatPercent(r.contributionMarginPercent)})</span>
                </td>
                <td className="px-3 py-2 text-right">
                  <span className={r.netMarginCents >= 0 ? "text-green-700" : "text-red-700"}>
                    {formatCad(r.netMarginCents)}
                  </span>{" "}
                  <span className="text-gray-500">({formatPercent(r.netMarginPercent)})</span>
                </td>
              </tr>
            ))}
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

export default function ContabilidadPage() {
  const [data, setData] = useState<AccountingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [exportMonth, setExportMonth] = useState(() => new Date().toISOString().slice(0, 7));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const res = await fetch(`/api/admin/accounting?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error loading accounting data");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
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
        paid. Actual net margin = collected − paid − employer burden (CPP/EI/WorkSafeBC). Employer burden is
        shown as 0 until a payroll snapshot exists for the corresponding cycle.
      </p>

      <div className="flex items-end gap-3 mb-6">
        <div>
          <label className="block text-xs text-gray-500 mb-1">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border rounded px-2 py-1 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border rounded px-2 py-1 text-sm" />
        </div>
        <button onClick={load} className="px-3 py-1.5 bg-gray-900 text-white rounded text-sm">
          Filter
        </button>
      </div>

      <div className="flex items-end gap-3 mb-6 border-t pt-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Universal export (month)</label>
          <input
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
      {error && <div className="text-red-600 text-sm mb-4">{error}</div>}

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
          <GroupTable title="By service type" rows={data.byServiceType} />
          <GroupTable title="By team" rows={data.byTeam} />
        </>
      )}
    </div>
  );
}

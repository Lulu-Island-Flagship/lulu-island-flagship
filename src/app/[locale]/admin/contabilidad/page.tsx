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
  return (cents / 100).toLocaleString("es-CA", { style: "currency", currency: "CAD" });
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
              <th className="px-3 py-2 text-left">Grupo</th>
              <th className="px-3 py-2 text-right">Órdenes</th>
              <th className="px-3 py-2 text-right">Cobrado</th>
              <th className="px-3 py-2 text-right">Pagado (nómina)</th>
              <th className="px-3 py-2 text-right">Carga patronal</th>
              <th className="px-3 py-2 text-right">Margen contribución</th>
              <th className="px-3 py-2 text-right">Margen neto real</th>
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
                  Sin datos en el rango seleccionado.
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
      if (!res.ok) throw new Error(json.error || "Error cargando contabilidad");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
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
        <h1 className="text-2xl font-bold">Contabilidad operativa</h1>
      </div>

      <p className="text-sm text-gray-500 mb-4">
        Cobrado = monto real capturado del cliente. Pagado = nómina bruta. Margen de contribución = cobrado −
        pagado. Margen neto real = cobrado − pagado − carga patronal (CPP/EI/WorkSafeBC). La carga patronal se
        muestra en 0 hasta que exista un snapshot de nómina para el ciclo correspondiente.
      </p>

      <div className="flex items-end gap-3 mb-6">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Desde</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border rounded px-2 py-1 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Hasta</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border rounded px-2 py-1 text-sm" />
        </div>
        <button onClick={load} className="px-3 py-1.5 bg-gray-900 text-white rounded text-sm">
          Filtrar
        </button>
      </div>

      <div className="flex items-end gap-3 mb-6 border-t pt-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Exportación universal (mes)</label>
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
          Sin dependencia de QBO — ingresos, nómina, comisiones, regalos y reservas de impuestos del mes (D.9.5).
        </span>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Cargando…
        </div>
      )}
      {error && <div className="text-red-600 text-sm mb-4">{error}</div>}

      {data && !loading && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
            <div className="border rounded p-4">
              <div className="text-xs text-gray-500 mb-1">Total cobrado</div>
              <div className="text-xl font-semibold">{formatCad(data.overall.collectedCents)}</div>
            </div>
            <div className="border rounded p-4">
              <div className="text-xs text-gray-500 mb-1">Margen neto real</div>
              <div className={`text-xl font-semibold flex items-center gap-1 ${data.overall.netMarginCents >= 0 ? "text-green-700" : "text-red-700"}`}>
                {data.overall.netMarginCents >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                {formatCad(data.overall.netMarginCents)} ({formatPercent(data.overall.netMarginPercent)})
              </div>
            </div>
          </div>

          <GroupTable title="Por zona" rows={data.byZone} />
          <GroupTable title="Por tipo de servicio" rows={data.byServiceType} />
          <GroupTable title="Por equipo" rows={data.byTeam} />
        </>
      )}
    </div>
  );
}

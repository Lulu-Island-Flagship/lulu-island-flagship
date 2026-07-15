"use client";

import React, { useEffect, useState } from "react";
import { Loader2, Landmark, AlertTriangle, CheckCircle2 } from "lucide-react";

interface Period {
  id: string;
  remittance_type: "cpp_ei_monthly" | "gst_pst_quarterly" | "t4_annual";
  period_start: string;
  period_end: string;
  due_date: string;
  status: "pending" | "filed";
  filed_at: string | null;
  confirmation_reference: string | null;
  amount_cents: number | null;
  overdue: boolean;
}

const TYPE_LABEL: Record<string, string> = {
  cpp_ei_monthly: "CPP/EI (monthly)",
  gst_pst_quarterly: "GST/PST NETFILE (quarterly)",
  t4_annual: "T4 (annual)",
};

function formatCad(cents: number | null): string {
  if (cents === null) return "—";
  return (cents / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
}

/**
 * v8.3 E9.4 — Calendario de obligaciones CRA. Esqueleto de fechas límite
 * (src/lib/cra-remittances.ts), NO un motor de cálculo fiscal ni NETFILE
 * real — ver comentario de alcance en esa lib.
 */
export default function CraRemittancesPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [periods, setPeriods] = useState<Period[]>([]);
  const [overdueCount, setOverdueCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    load(year);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  async function load(y: number) {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/cra-remittances?year=${y}`, { credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setPeriods(data.periods || []);
      setOverdueCount(data.overdueCount || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  async function markFiled(id: string) {
    const confirmationReference = window.prompt("Confirmation reference / receipt number:");
    if (!confirmationReference) return;
    const amountStr = window.prompt("Amount remitted (CAD, optional):");
    const amountCents = amountStr ? Math.round(parseFloat(amountStr) * 100) : undefined;
    try {
      const res = await fetch(`/api/admin/cra-remittances/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ confirmationReference, amountCents }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      await load(year);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <Landmark className="w-6 h-6" />
        <h1 className="text-2xl font-bold">CRA Remittance Calendar</h1>
        <select
          aria-label="Seleccionar año"
          value={year}
          onChange={(e) => setYear(parseInt(e.target.value, 10))}
          className="ml-auto border rounded px-2 py-1 text-sm"
        >
          {[year - 1, year, year + 1].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        Reminder calendar only — CPP/EI monthly, GST/PST quarterly NETFILE, T4 annual. Amounts and
        actual filing happen in QBO / with the accountant; this just makes sure nothing is
        forgotten (E9.4).
      </p>

      {overdueCount > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded p-3 text-sm border bg-red-50 border-red-200 text-red-700">
          <AlertTriangle className="w-4 h-4" />
          {overdueCount} period(s) past due and still pending.
        </div>
      )}
      {error && <div className="text-red-600 text-sm mb-4">{error}</div>}

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="overflow-x-auto rounded border border-gray-200">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Period</th>
                <th className="px-3 py-2 text-left">Due</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left"></th>
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => (
                <tr key={p.id} className={`border-t border-gray-100 ${p.overdue ? "bg-red-50" : ""}`}>
                  <td className="px-3 py-2">{TYPE_LABEL[p.remittance_type]}</td>
                  <td className="px-3 py-2 text-xs text-gray-500">
                    {p.period_start} → {p.period_end}
                  </td>
                  <td className={`px-3 py-2 ${p.overdue ? "text-red-700 font-medium" : ""}`}>
                    {new Date(p.due_date).toLocaleDateString("en-CA")}
                  </td>
                  <td className="px-3 py-2 text-right">{formatCad(p.amount_cents)}</td>
                  <td className="px-3 py-2">
                    {p.status === "filed" ? (
                      <span className="inline-flex items-center gap-1 text-green-700 text-xs">
                        <CheckCircle2 className="w-3 h-3" /> Filed
                        {p.confirmation_reference ? ` · ${p.confirmation_reference}` : ""}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-500">Pending</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {p.status === "pending" && (
                      <button onClick={() => markFiled(p.id)} className="text-xs text-brand-navy underline">
                        Mark filed
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

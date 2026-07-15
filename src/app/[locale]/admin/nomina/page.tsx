"use client";

import React, { useEffect, useState } from "react";
import { Loader2, Wallet, Download } from "lucide-react";

interface PayrollLine {
  employeeId: string;
  employeeName: string;
  services: number;
  deductions: {
    grossCents: number;
    cpp: { baseContributionCents: number; cpp2ContributionCents: number };
    ei: { employeeCents: number; employerCents: number };
    workSafeBc: { employerCents: number };
    vacationPayAccrualCents: number;
    estimatedNetCents: number;
    employerCostCents: number;
  };
}

interface Cycle {
  label: string;
  start: string;
  end: string;
}

/**
 * v8.3 E9.3 — Nómina completa exportable: CPP/CPP2/EI/WorkSafeBC/Vacation
 * Pay por empleado. El backend (src/app/api/admin/payroll-export/route.ts)
 * ya existía; esta página cierra el gap de que nadie podía verlo ni
 * descargarlo sin llamar la API a mano.
 *
 * LIMITACIÓN EXPLÍCITA (heredada de la ruta): no incluye retención de
 * impuesto federal/provincial, ni formato PDF/QBO-Payroll ni firma digital
 * de conformidad -- solo CSV/JSON con el desglose de deducciones reales.
 */
export default function PayrollExportPage() {
  const [cycle, setCycle] = useState<Cycle | null>(null);
  const [lines, setLines] = useState<PayrollLine[]>([]);
  const [which, setWhich] = useState<"previous" | "current">("previous");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [which]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/payroll-export?cycle=${which}&format=json`, { credentials: "include" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to load");
        return;
      }
      setCycle(data.cycle);
      setLines(data.lines || []);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  function downloadCsv() {
    window.open(`/api/admin/payroll-export?cycle=${which}&format=csv`, "_blank");
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
      </div>
    );
  }

  const totalGross = lines.reduce((s, l) => s + l.deductions.grossCents, 0);
  const totalNet = lines.reduce((s, l) => s + l.deductions.estimatedNetCents, 0);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-brand-ink flex items-center gap-2">
            <Wallet className="w-6 h-6" /> Payroll Export
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {cycle ? `${cycle.label} (${cycle.start} to ${cycle.end})` : ""} — CPP/EI/WorkSafeBC/Vacation Pay per
            employee. Does not include federal/provincial income tax withholding.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={which}
            onChange={(e) => setWhich(e.target.value as "previous" | "current")}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="previous">Previous cycle (to pay)</option>
            <option value="current">Current cycle</option>
          </select>
          <button
            onClick={downloadCsv}
            className="inline-flex items-center gap-1.5 bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            <Download className="w-4 h-4" /> CSV
          </button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>}

      {lines.length === 0 ? (
        <div className="bg-white rounded-xl border p-8 text-center text-sm text-gray-500">
          No payroll entries for this cycle.
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl border p-5 grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-gray-500">Total gross</p>
              <p className="font-semibold text-brand-ink">${(totalGross / 100).toFixed(2)}</p>
            </div>
            <div>
              <p className="text-gray-500">Total estimated net</p>
              <p className="font-semibold text-brand-ink">${(totalNet / 100).toFixed(2)}</p>
            </div>
          </div>

          <div className="bg-white rounded-xl border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-gray-500">
                  <th className="p-3">Employee</th>
                  <th className="p-3">Services</th>
                  <th className="p-3">Gross</th>
                  <th className="p-3">CPP</th>
                  <th className="p-3">EI (emp.)</th>
                  <th className="p-3">WorkSafeBC</th>
                  <th className="p-3">Vacation Pay</th>
                  <th className="p-3">Est. Net</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.employeeId} className="border-b last:border-0">
                    <td className="p-3 text-brand-ink">{l.employeeName}</td>
                    <td className="p-3">{l.services}</td>
                    <td className="p-3">${(l.deductions.grossCents / 100).toFixed(2)}</td>
                    <td className="p-3">
                      $
                      {(
                        (l.deductions.cpp.baseContributionCents + l.deductions.cpp.cpp2ContributionCents) /
                        100
                      ).toFixed(2)}
                    </td>
                    <td className="p-3">${(l.deductions.ei.employeeCents / 100).toFixed(2)}</td>
                    <td className="p-3">${(l.deductions.workSafeBc.employerCents / 100).toFixed(2)}</td>
                    <td className="p-3">${(l.deductions.vacationPayAccrualCents / 100).toFixed(2)}</td>
                    <td className="p-3 font-medium">${(l.deductions.estimatedNetCents / 100).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

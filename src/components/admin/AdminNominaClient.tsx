"use client";

import React, { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Wallet, Download } from "lucide-react";
import ConfirmActionModal from "@/components/admin/ConfirmActionModal";

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
export default function AdminNominaClient() {
  const t = useTranslations("admin.nomina");
  const [cycle, setCycle] = useState<Cycle | null>(null);
  const [lines, setLines] = useState<PayrollLine[]>([]);
  const [which, setWhich] = useState<"previous" | "current">("previous");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Fix (auditoría externa 2026-07-31): el botón decía solo "CSV" pero en
  // realidad dispara un POST que APLICA de forma real las deducciones del
  // ciclo (CPP/EI/WorkSafeBC) en payroll_cycle_deductions/payroll_ytd --
  // un admin podía cerrar un ciclo de nómina real creyendo que solo
  // descargaba un archivo. Se agrega un paso de confirmación explícito
  // antes del POST, y el label del botón deja de decir solo "CSV".
  const [showCloseCycleConfirm, setShowCloseCycleConfirm] = useState(false);

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
        setError(data.error || t("loadError"));
        return;
      }
      setCycle(data.cycle);
      setLines(data.lines || []);
    } catch {
      setError(t("networkError"));
    } finally {
      setLoading(false);
    }
  }

  // Fix (auditoría externa 2026-07-30): el GET de payroll-export ya no muta
  // datos (ver route.ts) -- el CSV oficial (el que aplica la deducción del
  // ciclo en payroll_cycle_deductions/payroll_ytd) ahora requiere POST.
  // window.open() solo puede hacer GET, así que se reemplaza por un
  // fetch(POST) + descarga vía blob URL.
  async function downloadCsv() {
    setError("");
    try {
      const res = await fetch(`/api/admin/payroll-export?cycle=${which}&format=csv`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error || t("loadError"));
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `nomina_${cycle?.label?.replace(/\s+/g, "_") || which}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      // El POST acaba de aplicar la deducción del ciclo -- refresca la
      // previsualización para que refleje el estado ya procesado.
      load();
    } catch {
      setError(t("networkError"));
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold-dark" />
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
            <Wallet className="w-6 h-6" /> {t("title")}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {cycle ? `${cycle.label} (${cycle.start} to ${cycle.end})` : ""} — {t("subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            aria-label={t("cycleSelectAriaLabel")}
            value={which}
            onChange={(e) => setWhich(e.target.value as "previous" | "current")}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="previous">{t("cycleOptions.previous")}</option>
            <option value="current">{t("cycleOptions.current")}</option>
          </select>
          <button
            onClick={() => setShowCloseCycleConfirm(true)}
            className="inline-flex items-center gap-1.5 bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            <Download className="w-4 h-4" /> {t("csvButton")}
          </button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>}

      {showCloseCycleConfirm && (
        <ConfirmActionModal
          title={t("closeCycleConfirm.title")}
          message={t("closeCycleConfirm.message")}
          noticeText={t("closeCycleConfirm.notice")}
          confirmLabel={t("closeCycleConfirm.confirmLabel")}
          danger
          onCancel={() => setShowCloseCycleConfirm(false)}
          onConfirm={async () => {
            await downloadCsv();
            setShowCloseCycleConfirm(false);
          }}
        />
      )}

      {lines.length === 0 ? (
        <div className="bg-white rounded-xl border p-8 text-center text-sm text-gray-500">
          {t("empty")}
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl border p-5 grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-gray-500">{t("totals.gross")}</p>
              <p className="font-semibold text-brand-ink">${(totalGross / 100).toFixed(2)}</p>
            </div>
            <div>
              <p className="text-gray-500">{t("totals.net")}</p>
              <p className="font-semibold text-brand-ink">${(totalNet / 100).toFixed(2)}</p>
            </div>
          </div>

          <div className="bg-white rounded-xl border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-gray-500">
                  <th scope="col" className="p-3">{t("table.employee")}</th>
                  <th scope="col" className="p-3">{t("table.services")}</th>
                  <th scope="col" className="p-3">{t("table.gross")}</th>
                  <th scope="col" className="p-3">{t("table.cpp")}</th>
                  <th scope="col" className="p-3">{t("table.eiEmployee")}</th>
                  <th scope="col" className="p-3">{t("table.workSafeBc")}</th>
                  <th scope="col" className="p-3">{t("table.vacationPay")}</th>
                  <th scope="col" className="p-3">{t("table.estNet")}</th>
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

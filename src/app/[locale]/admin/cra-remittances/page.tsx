"use client";

import React, { useEffect, useState } from "react";
import { Loader2, Landmark, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useTranslations } from "next-intl";
import ConfirmActionModal from "@/components/admin/ConfirmActionModal";

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

const TYPE_KEYS: Record<string, string> = {
  cpp_ei_monthly: "cppEiMonthly",
  gst_pst_quarterly: "gstPstQuarterly",
  t4_annual: "t4Annual",
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
  const t = useTranslations("admin.craRemittances");
  const [year, setYear] = useState(new Date().getFullYear());
  const [periods, setPeriods] = useState<Period[]>([]);
  const [overdueCount, setOverdueCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // 2026-07-24 fix: reemplaza los dos window.prompt() (referencia + monto)
  // por un único ConfirmActionModal con dos campos.
  const [filingId, setFilingId] = useState<string | null>(null);

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
      if (!res.ok) throw new Error(data.error || t("errors.loadFailed"));
      setPeriods(data.periods || []);
      setOverdueCount(data.overdueCount || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.network"));
    } finally {
      setLoading(false);
    }
  }

  async function markFiled(id: string, confirmationReference: string, amountStr: string) {
    const amountCents = amountStr ? Math.round(parseFloat(amountStr) * 100) : undefined;
    const res = await fetch(`/api/admin/cra-remittances/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ confirmationReference, amountCents }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t("errors.genericFailed"));
    await load(year);
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <Landmark className="w-6 h-6" />
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <select
          aria-label={t("yearAria")}
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
      <p className="text-sm text-gray-500 mb-6">{t("subtitle")}</p>

      {overdueCount > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded p-3 text-sm border bg-red-50 border-red-200 text-red-700">
          <AlertTriangle className="w-4 h-4" />
          {t("overdueBanner", { count: overdueCount })}
        </div>
      )}
      {error && <div className="text-red-600 text-sm mb-4">{error}</div>}

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" /> {t("loading")}
        </div>
      ) : (
        <div className="overflow-x-auto rounded border border-gray-200">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-3 py-2 text-left">{t("table.type")}</th>
                <th scope="col" className="px-3 py-2 text-left">{t("table.period")}</th>
                <th scope="col" className="px-3 py-2 text-left">{t("table.due")}</th>
                <th scope="col" className="px-3 py-2 text-right">{t("table.amount")}</th>
                <th scope="col" className="px-3 py-2 text-left">{t("table.status")}</th>
                <th scope="col" className="px-3 py-2 text-left"><span className="sr-only">{t("table.actions")}</span></th>
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => (
                <tr key={p.id} className={`border-t border-gray-100 ${p.overdue ? "bg-red-50" : ""}`}>
                  <td className="px-3 py-2">{t(`types.${TYPE_KEYS[p.remittance_type]}`)}</td>
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
                        <CheckCircle2 className="w-3 h-3" /> {t("filed")}
                        {p.confirmation_reference ? ` · ${p.confirmation_reference}` : ""}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-500">{t("pending")}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {p.status === "pending" && (
                      <button onClick={() => setFilingId(p.id)} className="text-xs text-brand-navy underline">
                        {t("markFiled")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {filingId && (
        <ConfirmActionModal
          title={t("modal.title")}
          confirmLabel={t("markFiled")}
          fields={[
            {
              key: "confirmationReference",
              label: t("modal.referenceLabel"),
              autoFocus: true,
            },
            {
              key: "amount",
              label: t("modal.amountLabel"),
              type: "number",
              required: false,
              helperText: t("modal.optional"),
            },
          ]}
          onCancel={() => setFilingId(null)}
          onConfirm={async (values) => {
            await markFiled(filingId, values.confirmationReference, values.amount);
            setFilingId(null);
          }}
        />
      )}
    </div>
  );
}

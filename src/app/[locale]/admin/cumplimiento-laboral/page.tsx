"use client";

import React, { useEffect, useState } from "react";
import { Loader2, Clock, AlertTriangle, HeartPulse, CalendarDays, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";

type Tab = "rest" | "sick" | "weekly" | "holidays";

interface RestRow {
  employeeId: string;
  employeeName: string;
  workDate: string;
  segments: number;
  satisfying: number;
  atRisk: boolean;
}

interface SickRow {
  id: string;
  employeeName: string;
  absence_date: string;
  reason_type: string;
  reason_text: string;
  pay_type: string;
  documentSignedUrl: string | null;
}

interface WeeklyViolationRow {
  id: string;
  employeeName: string;
  week_start: string;
  week_end: string;
  longest_gap_hours: number;
}

interface HolidayRecord {
  id: string;
  employeeName: string;
  holiday_name: string;
  holiday_date: string;
  eligible: boolean;
  wage_data_unavailable: boolean;
  average_day_pay_cents: number | null;
}

function formatCad(cents: number | null): string {
  if (cents === null) return "—";
  return (cents / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
}

/**
 * v8.3 — Cumplimiento laboral BC ESA en un solo panel: descansos
 * documentados (tránsito), enfermedad, descanso semanal 32h, festivos
 * pagados. Cada pestaña llama a su propio endpoint ya construido.
 */
export default function CumplimientoLaboralPage() {
  const t = useTranslations("admin.cumplimientoLaboral");
  const [tab, setTab] = useState<Tab>("rest");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [restRows, setRestRows] = useState<RestRow[]>([]);
  const [sickRows, setSickRows] = useState<SickRow[]>([]);
  const [weeklyRows, setWeeklyRows] = useState<WeeklyViolationRow[]>([]);
  const [holidayRecords, setHolidayRecords] = useState<HolidayRecord[]>([]);

  useEffect(() => {
    load(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function load(tabId: Tab) {
    setLoading(true);
    setError("");
    try {
      if (tabId === "rest") {
        const res = await fetch("/api/admin/rest-periods?days=14", { credentials: "include" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setRestRows(data.rows || []);
      } else if (tabId === "sick") {
        const res = await fetch("/api/admin/sick-leave", { credentials: "include" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setSickRows(data.requests || []);
      } else if (tabId === "weekly") {
        const res = await fetch("/api/admin/weekly-rest-violations", { credentials: "include" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setWeeklyRows(data.violations || []);
      } else if (tabId === "holidays") {
        const res = await fetch("/api/admin/statutory-holiday-pay", { credentials: "include" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setHolidayRecords(data.records || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.network"));
    } finally {
      setLoading(false);
    }
  }

  const tabs: { id: Tab; labelKey: string; icon: React.ElementType }[] = [
    { id: "rest", labelKey: "tabs.rest", icon: Clock },
    { id: "sick", labelKey: "tabs.sick", icon: HeartPulse },
    { id: "weekly", labelKey: "tabs.weekly", icon: AlertTriangle },
    { id: "holidays", labelKey: "tabs.holidays", icon: CalendarDays },
  ];

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">{t("title")}</h1>
      <p className="text-sm text-gray-500 mb-4">{t("subtitle")}</p>

      <div className="flex gap-2 mb-4 border-b">
        {tabs.map((tabDef) => {
          const Icon = tabDef.icon;
          return (
            <button
              key={tabDef.id}
              onClick={() => setTab(tabDef.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 ${
                tab === tabDef.id ? "border-brand-navy text-brand-navy font-medium" : "border-transparent text-gray-500"
              }`}
            >
              <Icon className="w-4 h-4" /> {t(tabDef.labelKey)}
            </button>
          );
        })}
      </div>

      {error && <div className="text-red-600 text-sm mb-4">{error}</div>}

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" /> {t("loading")}
        </div>
      ) : (
        <>
          {tab === "rest" && (
            <div className="overflow-x-auto rounded border border-gray-200">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left">{t("table.employee")}</th>
                    <th scope="col" className="px-3 py-2 text-left">{t("table.date")}</th>
                    <th scope="col" className="px-3 py-2 text-right">{t("table.segments")}</th>
                    <th scope="col" className="px-3 py-2 text-right">{t("table.qualifyingBreaks")}</th>
                    <th scope="col" className="px-3 py-2 text-left">{t("table.risk")}</th>
                  </tr>
                </thead>
                <tbody>
                  {restRows.map((r) => (
                    <tr key={`${r.employeeId}-${r.workDate}`} className={`border-t ${r.atRisk ? "bg-red-50" : ""}`}>
                      <td className="px-3 py-2">{r.employeeName}</td>
                      <td className="px-3 py-2">{r.workDate}</td>
                      <td className="px-3 py-2 text-right">{r.segments}</td>
                      <td className="px-3 py-2 text-right">{r.satisfying}</td>
                      <td className="px-3 py-2">
                        {r.atRisk && (
                          <span className="text-red-700 text-xs flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" /> {t("noQualifyingBreak")}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {restRows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-4 text-center text-gray-400">
                        {t("noData")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {tab === "sick" && (
            <div className="overflow-x-auto rounded border border-gray-200">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left">{t("table.employee")}</th>
                    <th scope="col" className="px-3 py-2 text-left">{t("table.date")}</th>
                    <th scope="col" className="px-3 py-2 text-left">{t("table.reason")}</th>
                    <th scope="col" className="px-3 py-2 text-left">{t("table.payType")}</th>
                    <th scope="col" className="px-3 py-2 text-left">{t("table.note")}</th>
                  </tr>
                </thead>
                <tbody>
                  {sickRows.map((r) => (
                    <tr key={r.id} className="border-t">
                      <td className="px-3 py-2">{r.employeeName}</td>
                      <td className="px-3 py-2">{r.absence_date}</td>
                      <td className="px-3 py-2">{r.reason_text}</td>
                      <td className="px-3 py-2">{r.pay_type}</td>
                      <td className="px-3 py-2">
                        {r.documentSignedUrl && (
                          <a
                            href={r.documentSignedUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-brand-navy text-xs flex items-center gap-1"
                          >
                            <ExternalLink className="w-3 h-3" /> {t("view")}
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                  {sickRows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-4 text-center text-gray-400">
                        {t("noData")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {tab === "weekly" && (
            <div className="overflow-x-auto rounded border border-gray-200">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left">{t("table.employee")}</th>
                    <th scope="col" className="px-3 py-2 text-left">{t("table.week")}</th>
                    <th scope="col" className="px-3 py-2 text-right">{t("table.longestGap")}</th>
                  </tr>
                </thead>
                <tbody>
                  {weeklyRows.map((r) => (
                    <tr key={r.id} className="border-t bg-amber-50">
                      <td className="px-3 py-2">{r.employeeName}</td>
                      <td className="px-3 py-2">
                        {r.week_start} → {r.week_end}
                      </td>
                      <td className="px-3 py-2 text-right">{r.longest_gap_hours.toFixed(1)}</td>
                    </tr>
                  ))}
                  {weeklyRows.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-3 py-4 text-center text-gray-400">
                        {t("noViolations")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {tab === "holidays" && (
            <div className="overflow-x-auto rounded border border-gray-200">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left">{t("table.employee")}</th>
                    <th scope="col" className="px-3 py-2 text-left">{t("table.holiday")}</th>
                    <th scope="col" className="px-3 py-2 text-left">{t("table.date")}</th>
                    <th scope="col" className="px-3 py-2 text-left">{t("table.eligible")}</th>
                    <th scope="col" className="px-3 py-2 text-right">{t("table.avgDayPay")}</th>
                  </tr>
                </thead>
                <tbody>
                  {holidayRecords.map((r) => (
                    <tr key={r.id} className="border-t">
                      <td className="px-3 py-2">{r.employeeName}</td>
                      <td className="px-3 py-2">{r.holiday_name}</td>
                      <td className="px-3 py-2">{r.holiday_date}</td>
                      <td className="px-3 py-2">{r.eligible ? t("yes") : t("no")}</td>
                      <td className="px-3 py-2 text-right">
                        {r.wage_data_unavailable ? (
                          <span className="text-amber-600 text-xs">{t("wageDataUnavailable")}</span>
                        ) : (
                          formatCad(r.average_day_pay_cents)
                        )}
                      </td>
                    </tr>
                  ))}
                  {holidayRecords.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-4 text-center text-gray-400">
                        {t("noRecordsThisYear")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

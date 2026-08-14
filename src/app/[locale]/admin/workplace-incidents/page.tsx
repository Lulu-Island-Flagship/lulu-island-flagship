"use client";

import React, { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, HeartPulse, Clock, ShieldAlert, ShieldCheck, ClipboardCopy } from "lucide-react";

type ReportStatus = "pending" | "due_soon" | "overdue" | "filed_on_time" | "filed_late";

interface PrefilledReport {
  workerName: string;
  dateOfInjury: string;
  timeOfInjury: string;
  location: string;
  bodyPartAffected: string;
  natureOfInjury: string;
  medicalAttention: string;
  witnesses: string;
  immediateActionTaken: string;
  reportingDeadline: string;
  guidanceNote: string;
}

interface WorkplaceIncident {
  id: string;
  employeeName: string;
  incident_datetime: string;
  worksafebc_report_due_at: string;
  worksafebc_report_filed_at: string | null;
  worksafebc_reference_number: string | null;
  status: ReportStatus;
  prefilledReport: PrefilledReport;
}

const STATUS_STYLE: Record<ReportStatus, { className: string; icon: typeof Clock }> = {
  pending: { className: "text-gray-500", icon: Clock },
  due_soon: { className: "text-state-warning", icon: Clock },
  overdue: { className: "text-state-danger", icon: ShieldAlert },
  filed_on_time: { className: "text-state-success", icon: ShieldCheck },
  filed_late: { className: "text-amber-600", icon: ShieldAlert },
};

export default function WorkplaceIncidentsPage() {
  const t = useTranslations("admin.workplaceIncidents");
  const [items, setItems] = useState<WorkplaceIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [refNumbers, setRefNumbers] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const statusLabel = (status: ReportStatus) => t(`status.${status}`);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/workplace-incidents", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("errors.loadFailed"));
        return;
      }
      const data = await res.json();
      setItems(data.workplaceIncidents || []);
    } catch {
      setError(t("errors.network"));
    } finally {
      setLoading(false);
    }
  }

  async function markFiled(id: string) {
    setSaving(id);
    setError("");
    try {
      const res = await fetch("/api/admin/workplace-incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "mark_filed", id, referenceNumber: refNumbers[id] || undefined }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("errors.generic"));
        return;
      }
      await load();
    } catch {
      setError(t("errors.network"));
    } finally {
      setSaving(null);
    }
  }

  function copyReport(report: PrefilledReport) {
    // Plain-text payload pasted directly into the official (English-only)
    // WorkSafeBC report form — intentionally left in English regardless of
    // the admin's UI locale.
    const text = [
      `Worker: ${report.workerName}`,
      `Date of injury: ${report.dateOfInjury}`,
      `Time of injury: ${report.timeOfInjury}`,
      `Location: ${report.location}`,
      `Body part affected: ${report.bodyPartAffected}`,
      `Nature of injury: ${report.natureOfInjury}`,
      `Medical attention: ${report.medicalAttention}`,
      `Witnesses: ${report.witnesses}`,
      `Immediate action taken: ${report.immediateActionTaken}`,
      `Reporting deadline: ${new Date(report.reportingDeadline).toLocaleString("en-CA", { timeZone: "America/Vancouver" })}`,
      ``,
      report.guidanceNote,
    ].join("\n");
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold-dark" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-ink">{t("title")}</h1>
        <p className="text-sm text-gray-500 mt-1">{t("description")}</p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>}

      {items.length === 0 ? (
        <div className="bg-white rounded-xl border p-8 text-center">
          <HeartPulse className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p className="text-gray-500 text-sm">{t("empty")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const style = STATUS_STYLE[item.status];
            const Icon = style.icon;
            const isFiled = item.status === "filed_on_time" || item.status === "filed_late";
            return (
              <div key={item.id} className="bg-white rounded-xl border p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-brand-ink text-sm">{item.employeeName}</p>
                    <p className="text-xs text-gray-500">
                      {new Date(item.incident_datetime).toLocaleString("en-CA", { timeZone: "America/Vancouver" })}
                    </p>
                  </div>
                  <span className={`flex items-center gap-1 text-xs font-medium ${style.className}`}>
                    <Icon className="w-3.5 h-3.5" /> {statusLabel(item.status)}
                  </span>
                </div>
                <p className="text-xs text-gray-500">
                  {t("deadline")}: {new Date(item.worksafebc_report_due_at).toLocaleString("en-CA", { timeZone: "America/Vancouver" })}
                  {item.worksafebc_reference_number && ` — ${t("ref")}: ${item.worksafebc_reference_number}`}
                </p>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setExpanded(expanded === item.id ? null : item.id)}
                    className="text-xs text-brand-navy hover:underline"
                  >
                    {expanded === item.id ? t("hidePrefilled") : t("viewPrefilled")}
                  </button>
                  {!isFiled && (
                    <>
                      <input
                        type="text"
                        aria-label={t("referenceAria")}
                        placeholder={t("referencePlaceholder")}
                        value={refNumbers[item.id] || ""}
                        onChange={(e) => setRefNumbers((r) => ({ ...r, [item.id]: e.target.value }))}
                        className="border rounded-lg px-2 py-1 text-xs"
                      />
                      <button
                        onClick={() => markFiled(item.id)}
                        disabled={saving === item.id}
                        className="text-xs bg-brand-navy text-white px-3 py-1 rounded-lg disabled:opacity-50"
                      >
                        {saving === item.id ? t("saving") : t("markFiled")}
                      </button>
                    </>
                  )}
                </div>

                {expanded === item.id && (
                  <div className="bg-gray-50 rounded-lg p-3 text-xs space-y-1 text-gray-700">
                    <p><strong>{t("fields.worker")}:</strong> {item.prefilledReport.workerName}</p>
                    <p><strong>{t("fields.date")}:</strong> {item.prefilledReport.dateOfInjury} {item.prefilledReport.timeOfInjury}</p>
                    <p><strong>{t("fields.location")}:</strong> {item.prefilledReport.location}</p>
                    <p><strong>{t("fields.bodyPart")}:</strong> {item.prefilledReport.bodyPartAffected}</p>
                    <p><strong>{t("fields.natureOfInjury")}:</strong> {item.prefilledReport.natureOfInjury}</p>
                    <p><strong>{t("fields.medicalAttention")}:</strong> {item.prefilledReport.medicalAttention}</p>
                    <p><strong>{t("fields.witnesses")}:</strong> {item.prefilledReport.witnesses}</p>
                    <p><strong>{t("fields.immediateAction")}:</strong> {item.prefilledReport.immediateActionTaken}</p>
                    <p className="text-amber-700 pt-1">{item.prefilledReport.guidanceNote}</p>
                    <button
                      onClick={() => copyReport(item.prefilledReport)}
                      className="inline-flex items-center gap-1 text-brand-navy hover:underline pt-1"
                    >
                      <ClipboardCopy className="w-3.5 h-3.5" /> {t("copyToClipboard")}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

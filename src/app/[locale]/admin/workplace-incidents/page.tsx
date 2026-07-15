"use client";

import React, { useEffect, useState } from "react";
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

const STATUS_STYLE: Record<ReportStatus, { className: string; label: string; icon: typeof Clock }> = {
  pending: { className: "text-gray-500", label: "Pending", icon: Clock },
  due_soon: { className: "text-state-warning", label: "Due soon", icon: Clock },
  overdue: { className: "text-state-danger", label: "OVERDUE", icon: ShieldAlert },
  filed_on_time: { className: "text-state-success", label: "Filed on time", icon: ShieldCheck },
  filed_late: { className: "text-amber-600", label: "Filed late", icon: ShieldAlert },
};

export default function WorkplaceIncidentsPage() {
  const [items, setItems] = useState<WorkplaceIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [refNumbers, setRefNumbers] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/workplace-incidents", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to load");
        return;
      }
      const data = await res.json();
      setItems(data.workplaceIncidents || []);
    } catch {
      setError("Network error");
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
        setError(err.error || "Failed");
        return;
      }
      await load();
    } catch {
      setError("Network error");
    } finally {
      setSaving(null);
    }
  }

  function copyReport(report: PrefilledReport) {
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
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-ink">Workplace Incidents — WorkSafeBC</h1>
        <p className="text-sm text-gray-500 mt-1">
          Injuries requiring the 72h WorkSafeBC report (D.10#6). No public submission API exists — this only
          pre-fills the data from what the system already knows. Copy it into the real WorkSafeBC form.
        </p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>}

      {items.length === 0 ? (
        <div className="bg-white rounded-xl border p-8 text-center">
          <HeartPulse className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p className="text-gray-500 text-sm">No workplace incidents reported.</p>
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
                    <Icon className="w-3.5 h-3.5" /> {style.label}
                  </span>
                </div>
                <p className="text-xs text-gray-500">
                  Deadline: {new Date(item.worksafebc_report_due_at).toLocaleString("en-CA", { timeZone: "America/Vancouver" })}
                  {item.worksafebc_reference_number && ` — Ref: ${item.worksafebc_reference_number}`}
                </p>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setExpanded(expanded === item.id ? null : item.id)}
                    className="text-xs text-brand-navy hover:underline"
                  >
                    {expanded === item.id ? "Hide pre-filled data" : "View pre-filled data"}
                  </button>
                  {!isFiled && (
                    <>
                      <input
                        type="text"
                        placeholder="Reference # (optional)"
                        value={refNumbers[item.id] || ""}
                        onChange={(e) => setRefNumbers((r) => ({ ...r, [item.id]: e.target.value }))}
                        className="border rounded-lg px-2 py-1 text-xs"
                      />
                      <button
                        onClick={() => markFiled(item.id)}
                        disabled={saving === item.id}
                        className="text-xs bg-brand-navy text-white px-3 py-1 rounded-lg disabled:opacity-50"
                      >
                        {saving === item.id ? "Saving..." : "Mark filed"}
                      </button>
                    </>
                  )}
                </div>

                {expanded === item.id && (
                  <div className="bg-gray-50 rounded-lg p-3 text-xs space-y-1 text-gray-700">
                    <p><strong>Worker:</strong> {item.prefilledReport.workerName}</p>
                    <p><strong>Date:</strong> {item.prefilledReport.dateOfInjury} {item.prefilledReport.timeOfInjury}</p>
                    <p><strong>Location:</strong> {item.prefilledReport.location}</p>
                    <p><strong>Body part:</strong> {item.prefilledReport.bodyPartAffected}</p>
                    <p><strong>Nature of injury:</strong> {item.prefilledReport.natureOfInjury}</p>
                    <p><strong>Medical attention:</strong> {item.prefilledReport.medicalAttention}</p>
                    <p><strong>Witnesses:</strong> {item.prefilledReport.witnesses}</p>
                    <p><strong>Immediate action:</strong> {item.prefilledReport.immediateActionTaken}</p>
                    <p className="text-amber-700 pt-1">{item.prefilledReport.guidanceNote}</p>
                    <button
                      onClick={() => copyReport(item.prefilledReport)}
                      className="inline-flex items-center gap-1 text-brand-navy hover:underline pt-1"
                    >
                      <ClipboardCopy className="w-3.5 h-3.5" /> Copy to clipboard
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

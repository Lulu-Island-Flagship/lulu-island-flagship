"use client";

import React, { useEffect, useState } from "react";
import { Loader2, ShieldCheck, ShieldAlert, AlertTriangle, PlayCircle, ClipboardEdit } from "lucide-react";

type DrillType = "restore_verification" | "succession_simulation" | "emergency_kit_check" | "fallback_no_admin";
type DrillResult = "pass" | "fail" | "partial";

interface Drill {
  id: string;
  drill_type: DrillType;
  tested_scope: string;
  result: DrillResult;
  duration_seconds: number | null;
  notes: string | null;
  created_at: string;
}

interface RtoTarget {
  id: string;
  data_type: string;
  rto_hours: number;
  recovery_method: string;
  is_example: boolean;
}

interface OverdueStatus {
  drillType: DrillType;
  intervalDays: number;
  lastRunAt: string | null;
  daysSinceLastRun: number | null;
  isOverdue: boolean;
}

const DRILL_TYPE_LABEL: Record<DrillType, string> = {
  restore_verification: "Restore verification (automated)",
  succession_simulation: "Succession simulation",
  emergency_kit_check: "Emergency kit check",
  fallback_no_admin: "Fallback without admin",
};

const RESULT_STYLE: Record<DrillResult, { className: string; icon: typeof ShieldCheck; label: string }> = {
  pass: { className: "text-state-success", icon: ShieldCheck, label: "Pass" },
  partial: { className: "text-state-warning", icon: AlertTriangle, label: "Partial" },
  fail: { className: "text-state-danger", icon: ShieldAlert, label: "Fail" },
};

export default function DrDrillPage() {
  const [drills, setDrills] = useState<Drill[]>([]);
  const [rtoTargets, setRtoTargets] = useState<RtoTarget[]>([]);
  const [overdueStatuses, setOverdueStatuses] = useState<OverdueStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [showManualForm, setShowManualForm] = useState<DrillType | null>(null);
  const [saving, setSaving] = useState(false);
  const [manualForm, setManualForm] = useState({ testedScope: "", manualResult: "pass" as DrillResult, notes: "" });

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/dr-drill", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to load");
        return;
      }
      const data = await res.json();
      setDrills(data.drills || []);
      setRtoTargets(data.rtoTargets || []);
      setOverdueStatuses(data.overdueStatuses || []);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function runRestoreVerification() {
    setRunning(true);
    setError("");
    try {
      const res = await fetch("/api/admin/dr-drill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          drillType: "restore_verification",
          testedScope: "Integrity check against current connected database",
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to run");
        return;
      }
      await load();
    } catch {
      setError("Network error");
    } finally {
      setRunning(false);
    }
  }

  async function submitManual(e: React.FormEvent) {
    e.preventDefault();
    if (!showManualForm || !manualForm.testedScope.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/dr-drill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          drillType: showManualForm,
          testedScope: manualForm.testedScope.trim(),
          manualResult: manualForm.manualResult,
          notes: manualForm.notes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to save");
        return;
      }
      setShowManualForm(null);
      setManualForm({ testedScope: "", manualResult: "pass", notes: "" });
      await load();
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
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
        <h1 className="text-2xl font-bold text-brand-ink">Disaster Recovery Drills</h1>
        <p className="text-sm text-gray-500 mt-1">
          Auditable log of DR drills (E11.4). Does not replace Supabase-managed backups or the monthly cold-storage
          pg_dump — this only records WHEN each drill type was run and its verifiable result.
        </p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {overdueStatuses.map((status) => (
          <div
            key={status.drillType}
            className={`bg-white rounded-xl border p-4 space-y-2 ${status.isOverdue ? "border-state-danger" : ""}`}
          >
            <p className="font-medium text-brand-ink text-sm">{DRILL_TYPE_LABEL[status.drillType]}</p>
            <p className="text-xs text-gray-400">Required every {status.intervalDays} days</p>
            {status.lastRunAt ? (
              <p className="text-xs text-gray-500">
                Last run: {new Date(status.lastRunAt).toLocaleDateString("en-CA", { timeZone: "America/Vancouver" })}
                {" "}({Math.floor(status.daysSinceLastRun ?? 0)}d ago)
              </p>
            ) : (
              <p className="text-xs text-gray-500">Never run</p>
            )}
            {status.isOverdue ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-state-danger">
                <ShieldAlert className="w-3.5 h-3.5" /> OVERDUE
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-state-success">
                <ShieldCheck className="w-3.5 h-3.5" /> On schedule
              </span>
            )}
            <div className="pt-1">
              {status.drillType === "restore_verification" ? (
                <button
                  aria-label="Ejecutar verificación de restauración"
                  onClick={runRestoreVerification}
                  disabled={running}
                  className="inline-flex items-center gap-1.5 text-xs text-brand-navy hover:underline disabled:opacity-50"
                >
                  <PlayCircle className="w-3.5 h-3.5" /> {running ? "Running..." : "Run now"}
                </button>
              ) : (
                <button
                  onClick={() => setShowManualForm(status.drillType)}
                  className="inline-flex items-center gap-1.5 text-xs text-brand-navy hover:underline"
                >
                  <ClipboardEdit className="w-3.5 h-3.5" /> Log drill
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {showManualForm && (
        <form onSubmit={submitManual} className="bg-white rounded-xl border p-4 space-y-3 max-w-lg">
          <h2 className="font-semibold text-brand-ink">Log: {DRILL_TYPE_LABEL[showManualForm]}</h2>
          <textarea
            aria-label="Alcance de lo probado en el simulacro"
            placeholder="What was tested (e.g. 'physical kit inspected, seal intact, credentials current')"
            value={manualForm.testedScope}
            onChange={(e) => setManualForm((f) => ({ ...f, testedScope: e.target.value }))}
            className="w-full border rounded-lg px-3 py-2 text-sm"
            rows={3}
            required
          />
          <select
            aria-label="Resultado del simulacro"
            value={manualForm.manualResult}
            onChange={(e) => setManualForm((f) => ({ ...f, manualResult: e.target.value as DrillResult }))}
            className="border rounded-lg px-3 py-2 text-sm"
          >
            <option value="pass">Pass</option>
            <option value="partial">Partial</option>
            <option value="fail">Fail</option>
          </select>
          <textarea
            aria-label="Notas adicionales del simulacro (opcional)"
            placeholder="Notes (optional)"
            value={manualForm.notes}
            onChange={(e) => setManualForm((f) => ({ ...f, notes: e.target.value }))}
            className="w-full border rounded-lg px-3 py-2 text-sm"
            rows={2}
          />
          <div className="flex gap-2">
            <button
              aria-label="Guardar registro del simulacro"
              type="submit"
              disabled={saving}
              className="bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
            <button type="button" onClick={() => setShowManualForm(null)} className="text-sm text-gray-500 px-4 py-2">
              Cancel
            </button>
          </div>
        </form>
      )}

      <div>
        <h2 className="font-semibold text-brand-ink mb-2">RTO Targets</h2>
        <div className="bg-white rounded-xl border divide-y">
          {rtoTargets.map((t) => (
            <div key={t.id} className="p-3 flex items-center justify-between text-sm">
              <span className="text-brand-ink">{t.data_type}{t.is_example && <span className="text-gray-400"> (example)</span>}</span>
              <span className="text-gray-500">{t.rto_hours}h — {t.recovery_method}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2 className="font-semibold text-brand-ink mb-2">History</h2>
        {drills.length === 0 ? (
          <div className="bg-white rounded-xl border p-6 text-center text-sm text-gray-500">No drills logged yet.</div>
        ) : (
          <div className="bg-white rounded-xl border divide-y">
            {drills.map((d) => {
              const style = RESULT_STYLE[d.result];
              const Icon = style.icon;
              return (
                <div key={d.id} className="p-3 flex items-start justify-between gap-3 text-sm">
                  <div>
                    <p className="font-medium text-brand-ink">{DRILL_TYPE_LABEL[d.drill_type]}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{d.tested_scope}</p>
                    {d.notes && <p className="text-xs text-gray-400 mt-0.5">{d.notes}</p>}
                    <p className="text-xs text-gray-400 mt-0.5">
                      {new Date(d.created_at).toLocaleString("en-CA", { timeZone: "America/Vancouver" })}
                      {d.duration_seconds !== null && ` — ${d.duration_seconds}s`}
                    </p>
                  </div>
                  <span className={`flex items-center gap-1 text-xs font-medium shrink-0 ${style.className}`}>
                    <Icon className="w-3.5 h-3.5" /> {style.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

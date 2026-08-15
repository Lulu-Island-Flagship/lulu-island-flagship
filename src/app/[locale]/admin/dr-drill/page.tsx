"use client";

// 2026-07-23: Consolidación de páginas duplicadas de continuidad de negocio.
// Existían dos páginas separadas para lo mismo: esta (/admin/dr-drill, enlazada
// solo desde el dashboard) y /admin/recuperacion-desastres (enlazada solo desde
// AdminNav.tsx). Ambas consumían la misma API (/api/admin/dr-drill) pero
// /admin/dr-drill tenía más funcionalidad real: bitácora manual para los 3 tipos
// de simulacro no automatizables (succession_simulation, emergency_kit_check,
// fallback_no_admin) y seguimiento de vencimiento por tipo (overdueStatuses).
// /admin/recuperacion-desastres solo exponía el botón de restore_verification y
// no tenía forma de registrar los otros simulacros -- estaba incompleta frente a
// esta. Se conservó esta página como única fuente de verdad, se le agregó el
// badge "confirmed / declared in plan" que sí tenía la otra, y
// /admin/recuperacion-desastres ahora solo redirige aquí (ver su page.tsx).
// AdminDashboardClient.tsx y AdminNav.tsx apuntan ambos a esta misma URL.
import React, { useEffect, useState, useCallback } from "react";
import { Loader2, ShieldCheck, ShieldAlert, AlertTriangle, PlayCircle, ClipboardEdit } from "lucide-react";
import { useTranslations } from "next-intl";

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

// 2026-07-23: RTO consolidada en formato legible (antes en /admin/recuperacion-desastres,
// eliminada por duplicar esta página — ver comentario más abajo y en AdminNav.tsx).
function formatRto(hours: number, t: (key: string, values?: Record<string, string | number>) => string): string {
  if (hours === 0) return t("rto.immediate");
  if (hours < 1) return t("rto.minutes", { count: Math.round(hours * 60) });
  if (hours < 24) return t("rto.hours", { count: hours });
  return t("rto.days", { count: (hours / 24).toFixed(1) });
}

interface OverdueStatus {
  drillType: DrillType;
  intervalDays: number;
  lastRunAt: string | null;
  daysSinceLastRun: number | null;
  isOverdue: boolean;
}

const DRILL_TYPE_KEYS: Record<DrillType, string> = {
  restore_verification: "restoreVerification",
  succession_simulation: "successionSimulation",
  emergency_kit_check: "emergencyKitCheck",
  fallback_no_admin: "fallbackNoAdmin",
};

const RESULT_STYLE: Record<DrillResult, { className: string; icon: typeof ShieldCheck; key: string }> = {
  pass: { className: "text-state-success", icon: ShieldCheck, key: "pass" },
  partial: { className: "text-state-warning", icon: AlertTriangle, key: "partial" },
  fail: { className: "text-state-danger", icon: ShieldAlert, key: "fail" },
};

export default function DrDrillPage() {
  const t = useTranslations("admin.drDrill");
  const [drills, setDrills] = useState<Drill[]>([]);
  const [rtoTargets, setRtoTargets] = useState<RtoTarget[]>([]);
  const [overdueStatuses, setOverdueStatuses] = useState<OverdueStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [showManualForm, setShowManualForm] = useState<DrillType | null>(null);
  const [saving, setSaving] = useState(false);
  const [manualForm, setManualForm] = useState({ testedScope: "", manualResult: "pass" as DrillResult, notes: "" });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/dr-drill", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("errors.loadFailed"));
        return;
      }
      const data = await res.json();
      setDrills(data.drills || []);
      setRtoTargets(data.rtoTargets || []);
      setOverdueStatuses(data.overdueStatuses || []);
    } catch {
      setError(t("errors.network"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

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
          testedScope: t("integrityCheckScope"),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("errors.runFailed"));
        return;
      }
      await load();
    } catch {
      setError(t("errors.network"));
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
        setError(err.error || t("errors.saveFailed"));
        return;
      }
      setShowManualForm(null);
      setManualForm({ testedScope: "", manualResult: "pass", notes: "" });
      await load();
    } catch {
      setError(t("errors.network"));
    } finally {
      setSaving(false);
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
        <p className="text-sm text-gray-500 mt-1">{t("subtitle")}</p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {overdueStatuses.map((status) => (
          <div
            key={status.drillType}
            className={`bg-white rounded-xl border p-4 space-y-2 ${status.isOverdue ? "border-state-danger" : ""}`}
          >
            <p className="font-medium text-brand-ink text-sm">{t(`drillTypes.${DRILL_TYPE_KEYS[status.drillType]}`)}</p>
            <p className="text-xs text-gray-400">{t("requiredEvery", { days: status.intervalDays })}</p>
            {status.lastRunAt ? (
              <p className="text-xs text-gray-500">
                {t("lastRun", {
                  date: new Date(status.lastRunAt).toLocaleDateString("en-CA", { timeZone: "America/Vancouver" }),
                  days: Math.floor(status.daysSinceLastRun ?? 0),
                })}
              </p>
            ) : (
              <p className="text-xs text-gray-500">{t("neverRun")}</p>
            )}
            {status.isOverdue ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-state-danger">
                <ShieldAlert className="w-3.5 h-3.5" /> {t("overdue")}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-state-success">
                <ShieldCheck className="w-3.5 h-3.5" /> {t("onSchedule")}
              </span>
            )}
            <div className="pt-1">
              {status.drillType === "restore_verification" ? (
                <button
                  aria-label={t("runRestoreVerificationAria")}
                  onClick={runRestoreVerification}
                  disabled={running}
                  className="inline-flex items-center gap-1.5 text-xs text-brand-navy hover:underline disabled:opacity-50"
                >
                  <PlayCircle className="w-3.5 h-3.5" /> {running ? t("running") : t("runNow")}
                </button>
              ) : (
                <button
                  onClick={() => setShowManualForm(status.drillType)}
                  className="inline-flex items-center gap-1.5 text-xs text-brand-navy hover:underline"
                >
                  <ClipboardEdit className="w-3.5 h-3.5" /> {t("logDrill")}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {showManualForm && (
        <form onSubmit={submitManual} className="bg-white rounded-xl border p-4 space-y-3 max-w-lg">
          <h2 className="font-semibold text-brand-ink">{t("logFormTitle", { type: t(`drillTypes.${DRILL_TYPE_KEYS[showManualForm]}`) })}</h2>
          <textarea
            aria-label={t("form.testedScopeAria")}
            placeholder={t("form.testedScopePlaceholder")}
            value={manualForm.testedScope}
            onChange={(e) => setManualForm((f) => ({ ...f, testedScope: e.target.value }))}
            className="w-full border rounded-lg px-3 py-2 text-sm"
            rows={3}
            required
          />
          <select
            aria-label={t("form.resultAria")}
            value={manualForm.manualResult}
            onChange={(e) => setManualForm((f) => ({ ...f, manualResult: e.target.value as DrillResult }))}
            className="border rounded-lg px-3 py-2 text-sm"
          >
            <option value="pass">{t("resultLabels.pass")}</option>
            <option value="partial">{t("resultLabels.partial")}</option>
            <option value="fail">{t("resultLabels.fail")}</option>
          </select>
          <textarea
            aria-label={t("form.notesAria")}
            placeholder={t("form.notesPlaceholder")}
            value={manualForm.notes}
            onChange={(e) => setManualForm((f) => ({ ...f, notes: e.target.value }))}
            className="w-full border rounded-lg px-3 py-2 text-sm"
            rows={2}
          />
          <div className="flex gap-2">
            <button
              aria-label={t("form.saveAria")}
              type="submit"
              disabled={saving}
              className="bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {saving ? t("form.saving") : t("form.save")}
            </button>
            <button type="button" onClick={() => setShowManualForm(null)} className="text-sm text-gray-500 px-4 py-2">
              {t("form.cancel")}
            </button>
          </div>
        </form>
      )}

      <div>
        <h2 className="font-semibold text-brand-ink mb-2">{t("rtoTargetsTitle")}</h2>
        <div className="bg-white rounded-xl border divide-y">
          {rtoTargets.map((rt) => (
            <div key={rt.id} className="p-3 flex items-center justify-between text-sm gap-3">
              <span className="text-brand-ink">{rt.data_type.replace(/_/g, " ")}</span>
              <span className="text-gray-500">{formatRto(rt.rto_hours, t)} — {rt.recovery_method}</span>
              {rt.is_example ? (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 shrink-0">
                  {t("declaredNotConfirmed")}
                </span>
              ) : (
                <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-800 shrink-0">{t("confirmed")}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2 className="font-semibold text-brand-ink mb-2">{t("historyTitle")}</h2>
        {drills.length === 0 ? (
          <div className="bg-white rounded-xl border p-6 text-center text-sm text-gray-500">{t("noDrillsLogged")}</div>
        ) : (
          <div className="bg-white rounded-xl border divide-y">
            {drills.map((d) => {
              const style = RESULT_STYLE[d.result];
              const Icon = style.icon;
              return (
                <div key={d.id} className="p-3 flex items-start justify-between gap-3 text-sm">
                  <div>
                    <p className="font-medium text-brand-ink">{t(`drillTypes.${DRILL_TYPE_KEYS[d.drill_type]}`)}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{d.tested_scope}</p>
                    {d.notes && <p className="text-xs text-gray-400 mt-0.5">{d.notes}</p>}
                    <p className="text-xs text-gray-400 mt-0.5">
                      {new Date(d.created_at).toLocaleString("en-CA", { timeZone: "America/Vancouver" })}
                      {d.duration_seconds !== null && ` — ${t("durationSeconds", { seconds: d.duration_seconds })}`}
                    </p>
                  </div>
                  <span className={`flex items-center gap-1 text-xs font-medium shrink-0 ${style.className}`}>
                    <Icon className="w-3.5 h-3.5" /> {t(`resultLabels.${style.key}`)}
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

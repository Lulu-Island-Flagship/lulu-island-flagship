"use client";

import React, { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Sparkles, CheckCircle2, XCircle, Send, CloudRain } from "lucide-react";
import ConfirmActionModal from "@/components/admin/ConfirmActionModal";

interface Campaign {
  campaign_key: string;
  display_name: string;
  suggested_month: number;
  description: string;
}

interface Run {
  id: string;
  campaign_key: string;
  campaign_year: number;
  multiplier: number;
  should_trigger: boolean;
  reason: string;
  status: "suggested" | "approved" | "rejected" | "dispatched";
  evaluated_at: string;
}

const MONTH_KEYS = [
  "", "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

const STATUS_STYLE: Record<Run["status"], string> = {
  suggested: "bg-blue-50 text-blue-700",
  approved: "bg-green-50 text-green-700",
  rejected: "bg-gray-100 text-gray-500",
  dispatched: "bg-purple-50 text-purple-700",
};

export default function SeasonalCampaignsPage() {
  const t = useTranslations("admin.seasonalCampaigns");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [evaluating, setEvaluating] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  // Item 12 (auditoría 2026-07-25): "Mark dispatched" activa el multiplicador
  // de precio de la campaña estacional en vivo para todas las reservas
  // nuevas, sin ninguna confirmación previa -- un clic accidental disparaba
  // una campaña de precios real. Se agrega ConfirmActionModal.
  const [pendingDispatchId, setPendingDispatchId] = useState<string | null>(null);

  const [signals, setSignals] = useState({
    isRainy: false,
    hasLocalEvent: false,
    isSchoolVacation: false,
    holiday: "" as "" | "mothers_day" | "christmas",
    highPollen: false,
  });

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/seasonal-campaigns", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("errors.loadFailed"));
        return;
      }
      const data = await res.json();
      setCampaigns(data.campaigns || []);
      setRuns(data.runs || []);
    } catch {
      setError(t("errors.network"));
    } finally {
      setLoading(false);
    }
  }

  async function evaluate() {
    setEvaluating(true);
    setError("");
    try {
      const res = await fetch("/api/admin/seasonal-campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action: "evaluate",
          signals: { ...signals, holiday: signals.holiday || null },
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("errors.evaluateFailed"));
        return;
      }
      await load();
    } catch {
      setError(t("errors.network"));
    } finally {
      setEvaluating(false);
    }
  }

  async function act(runId: string, action: "approve" | "reject" | "dispatch") {
    setActing(runId);
    try {
      const res = await fetch("/api/admin/seasonal-campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action, runId }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("errors.actionFailed"));
        return;
      }
      await load();
    } catch {
      setError(t("errors.network"));
    } finally {
      setActing(null);
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
        <h1 className="text-2xl font-bold text-brand-ink">{t("title")}</h1>
        <p className="text-sm text-gray-500 mt-1">{t("subtitle")}</p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        {campaigns.map((c) => (
          <div key={c.campaign_key} className="bg-white rounded-xl border p-3">
            <p className="font-medium text-brand-ink text-sm">{c.display_name}</p>
            <p className="text-xs text-gray-400 mt-1">{t("suggestedMonth", { month: t(`months.${MONTH_KEYS[c.suggested_month]}`) })}</p>
            <p className="text-xs text-gray-500 mt-2">{c.description}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border p-4 space-y-3">
        <h2 className="font-semibold text-brand-ink flex items-center gap-2">
          <CloudRain className="w-4 h-4 text-brand-wave-blue" />
          {t("signalsHeading")}
        </h2>
        <div className="flex flex-wrap gap-3 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" aria-label={t("signals.rainyAria")} checked={signals.isRainy} onChange={(e) => setSignals((s) => ({ ...s, isRainy: e.target.checked }))} />
            {t("signals.rainy")}
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" aria-label={t("signals.localEventAria")} checked={signals.hasLocalEvent} onChange={(e) => setSignals((s) => ({ ...s, hasLocalEvent: e.target.checked }))} />
            {t("signals.localEvent")}
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" aria-label={t("signals.schoolVacationAria")} checked={signals.isSchoolVacation} onChange={(e) => setSignals((s) => ({ ...s, isSchoolVacation: e.target.checked }))} />
            {t("signals.schoolVacation")}
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" aria-label={t("signals.highPollenAria")} checked={signals.highPollen} onChange={(e) => setSignals((s) => ({ ...s, highPollen: e.target.checked }))} />
            {t("signals.highPollen")}
          </label>
          <select
            aria-label={t("signals.holidayAria")}
            value={signals.holiday}
            onChange={(e) => setSignals((s) => ({ ...s, holiday: e.target.value as typeof signals.holiday }))}
            className="border rounded-lg px-2 py-1 text-sm"
          >
            <option value="">{t("signals.noHoliday")}</option>
            <option value="mothers_day">{t("signals.mothersDay")}</option>
            <option value="christmas">{t("signals.christmas")}</option>
          </select>
        </div>
        <button
          onClick={evaluate}
          disabled={evaluating}
          className="inline-flex items-center gap-2 bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-navy-light transition-colors disabled:opacity-50"
        >
          {evaluating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {t("evaluateAll")}
        </button>
      </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="px-4 py-3 border-b font-semibold text-brand-ink text-sm">{t("evaluationsHeading")}</div>
        {runs.length === 0 ? (
          <p className="text-sm text-gray-400 p-4">{t("noEvaluations")}</p>
        ) : (
          <div className="divide-y">
            {runs.map((run) => (
              <div key={run.id} className="p-4 flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-brand-ink text-sm">{run.campaign_key}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLE[run.status]}`}>{t(`statuses.${run.status}`)}</span>
                    {run.should_trigger && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">
                        {t("recommendsTrigger", { multiplier: run.multiplier })}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{run.reason}</p>
                </div>
                {run.status === "suggested" && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => act(run.id, "approve")}
                      disabled={acting === run.id}
                      className="inline-flex items-center gap-1 text-xs text-state-success hover:underline disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" /> {t("approve")}
                    </button>
                    <button
                      onClick={() => act(run.id, "reject")}
                      disabled={acting === run.id}
                      className="inline-flex items-center gap-1 text-xs text-state-danger hover:underline disabled:opacity-50"
                    >
                      <XCircle className="w-3.5 h-3.5" /> {t("reject")}
                    </button>
                  </div>
                )}
                {run.status === "approved" && (
                  <button
                    onClick={() => setPendingDispatchId(run.id)}
                    disabled={acting === run.id}
                    className="inline-flex items-center gap-1 text-xs text-brand-wave-blue hover:underline disabled:opacity-50 shrink-0"
                  >
                    <Send className="w-3.5 h-3.5" /> {t("markDispatched")}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {pendingDispatchId && (
        <ConfirmActionModal
          title={t("dispatchModal.title")}
          message={t("dispatchModal.message")}
          confirmLabel={t("markDispatched")}
          danger
          onCancel={() => setPendingDispatchId(null)}
          onConfirm={async () => {
            await act(pendingDispatchId, "dispatch");
            setPendingDispatchId(null);
          }}
        />
      )}
    </div>
  );
}

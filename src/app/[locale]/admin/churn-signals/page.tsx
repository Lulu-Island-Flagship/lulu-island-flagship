"use client";

import React, { useEffect, useState } from "react";
import { Loader2, UserMinus, Send, X, PhoneCall, ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";

type ChurnAction = "survey_20" | "discount_30_percent" | "personal_intervention" | "flag_unreported_dispute";

interface ChurnSignal {
  id: string;
  client_user_id: string;
  action: ChurnAction;
  reason: string;
  pattern: "recurring" | "sporadic" | null;
  days_since_last_service: number | null;
  source: "cron" | "manual";
  status: "pending" | "actioned" | "dismissed";
  created_at: string;
}

const ACTION_STYLE: Record<ChurnAction, { icon: typeof Send; className: string }> = {
  survey_20: { icon: Send, className: "text-brand-navy" },
  discount_30_percent: { icon: Send, className: "text-brand-navy" },
  personal_intervention: { icon: PhoneCall, className: "text-state-danger" },
  flag_unreported_dispute: { icon: ShieldAlert, className: "text-state-warning" },
};

export default function ChurnSignalsPage() {
  const t = useTranslations("admin.churnSignals");
  const [signals, setSignals] = useState<ChurnSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualForm, setManualForm] = useState({
    clientUserId: "",
    cancelledWithCompetitorMention: false,
    teamScorePrevious: "",
    teamScoreCurrent: "",
  });

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/churn-signals", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("errors.loadFailed"));
        return;
      }
      const data = await res.json();
      setSignals(data.churnSignals || []);
    } catch {
      setError(t("errors.network"));
    } finally {
      setLoading(false);
    }
  }

  async function resolveSignal(id: string, dismiss: boolean) {
    setBusy(id);
    setError("");
    try {
      const res = await fetch("/api/admin/churn-signals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: dismiss ? "dismiss" : "resolve", id }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("errors.genericFailed"));
        return;
      }
      await load();
    } catch {
      setError(t("errors.network"));
    } finally {
      setBusy(null);
    }
  }

  async function submitManual(e: React.FormEvent) {
    e.preventDefault();
    setBusy("manual");
    setError("");
    try {
      const res = await fetch("/api/admin/churn-signals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action: "flag_manual",
          clientUserId: manualForm.clientUserId.trim(),
          cancelledWithCompetitorMention: manualForm.cancelledWithCompetitorMention,
          teamScorePrevious: manualForm.teamScorePrevious ? Number(manualForm.teamScorePrevious) : undefined,
          teamScoreCurrent: manualForm.teamScoreCurrent ? Number(manualForm.teamScoreCurrent) : undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("errors.genericFailed"));
        return;
      }
      setShowManualForm(false);
      setManualForm({ clientUserId: "", cancelledWithCompetitorMention: false, teamScorePrevious: "", teamScoreCurrent: "" });
      await load();
    } catch {
      setError(t("errors.network"));
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
      </div>
    );
  }

  const pending = signals.filter((s) => s.status === "pending");
  const resolved = signals.filter((s) => s.status !== "pending");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-brand-ink">{t("title")}</h1>
          <p className="text-sm text-gray-500 mt-1">{t("subtitle")}</p>
        </div>
        <button
          onClick={() => setShowManualForm(true)}
          className="inline-flex items-center gap-2 bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-navy-light transition-colors"
        >
          {t("flagManually")}
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>}

      {showManualForm && (
        <form onSubmit={submitManual} className="bg-white rounded-xl border p-4 space-y-3 max-w-lg">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-brand-ink">{t("form.title")}</h2>
            <button type="button" onClick={() => setShowManualForm(false)} aria-label={t("form.closeAria")} className="text-gray-400 hover:text-gray-600">
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
          <input
            type="text"
            aria-label={t("form.clientIdAria")}
            placeholder={t("form.clientIdPlaceholder")}
            value={manualForm.clientUserId}
            onChange={(e) => setManualForm((f) => ({ ...f, clientUserId: e.target.value }))}
            className="w-full border rounded-lg px-3 py-2 text-sm"
            required
          />
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              aria-label={t("form.competitorMentionAria")}
              checked={manualForm.cancelledWithCompetitorMention}
              onChange={(e) => setManualForm((f) => ({ ...f, cancelledWithCompetitorMention: e.target.checked }))}
            />
            {t("form.competitorMentionLabel")}
          </label>
          <div className="grid grid-cols-2 gap-3">
            <input
              type="number"
              aria-label={t("form.teamScorePreviousAria")}
              placeholder={t("form.teamScorePreviousPlaceholder")}
              value={manualForm.teamScorePrevious}
              onChange={(e) => setManualForm((f) => ({ ...f, teamScorePrevious: e.target.value }))}
              className="border rounded-lg px-3 py-2 text-sm"
            />
            <input
              type="number"
              aria-label={t("form.teamScoreCurrentAria")}
              placeholder={t("form.teamScoreCurrentPlaceholder")}
              value={manualForm.teamScoreCurrent}
              onChange={(e) => setManualForm((f) => ({ ...f, teamScoreCurrent: e.target.value }))}
              className="border rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <button
            aria-label={t("form.saveAria")}
            type="submit"
            disabled={busy === "manual"}
            className="bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {busy === "manual" ? t("form.saving") : t("form.save")}
          </button>
        </form>
      )}

      <div>
        <h2 className="font-semibold text-brand-ink mb-2">{t("sections.pending", { count: pending.length })}</h2>
        {pending.length === 0 ? (
          <div className="bg-white rounded-xl border p-6 text-center text-sm text-gray-500">
            <UserMinus className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            {t("emptyStates.noPending")}
          </div>
        ) : (
          <div className="bg-white rounded-xl border divide-y">
            {pending.map((s) => {
              const style = ACTION_STYLE[s.action];
              const Icon = style.icon;
              return (
                <div key={s.id} className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className={`flex items-center gap-1.5 text-sm font-medium ${style.className}`}>
                      <Icon className="w-4 h-4" /> {t(`actions.${s.action}`)}
                    </span>
                    <span className="text-xs text-gray-400">{t(`sources.${s.source}`)}</span>
                  </div>
                  <p className="text-xs text-gray-500">{s.reason}</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => resolveSignal(s.id, false)}
                      disabled={busy === s.id}
                      className="text-xs bg-brand-navy text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
                    >
                      {busy === s.id ? "..." : t("markActioned")}
                    </button>
                    <button
                      onClick={() => resolveSignal(s.id, true)}
                      disabled={busy === s.id}
                      className="text-xs text-gray-500 px-3 py-1.5"
                    >
                      {t("dismiss")}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {resolved.length > 0 && (
        <div>
          <h2 className="font-semibold text-brand-ink mb-2">{t("sections.resolved")}</h2>
          <div className="bg-white rounded-xl border divide-y">
            {resolved.slice(0, 20).map((s) => (
              <div key={s.id} className="p-3 flex items-center justify-between text-sm">
                <span className="text-gray-600">{t(`actions.${s.action}`)}</span>
                <span className="text-xs text-gray-400">{t(`statusLabels.${s.status}`)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Loader2, TrendingUp, Plus, X, CheckCircle2, AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";

interface ChannelRow {
  channel: string;
  spendCents: number;
  newCustomers: number;
  cacCents: number;
  ltvCents: number;
  cacHealthy: boolean;
  suggestedBudgetCents: number;
}

interface AttributionData {
  month: string;
  channels: ChannelRow[];
  ltv: { valueCents: number; formula: string; inputs: Record<string, number> };
  budgetRange: { minCents: number; maxCents: number };
  previousMonthRevenueCents: number;
}

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function AttributionPage() {
  const t = useTranslations("admin.attribution");
  const [data, setData] = useState<AttributionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ channel: "", spendDollars: "", notes: "" });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/attribution", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("errors.loadFailed"));
        return;
      }
      setData(await res.json());
    } catch {
      setError(t("errors.network"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function submitSpend(e: React.FormEvent) {
    e.preventDefault();
    if (!data) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/attribution", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action: "record_spend",
          channel: form.channel.trim(),
          spendMonth: data.month,
          spendCents: Math.round(Number(form.spendDollars) * 100),
          notes: form.notes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("errors.saveFailed"));
        return;
      }
      setShowForm(false);
      setForm({ channel: "", spendDollars: "", notes: "" });
      await load();
    } catch {
      setError(t("errors.network"));
    } finally {
      setSaving(false);
    }
  }

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-brand-ink">{t("title")}</h1>
          <p className="text-sm text-gray-500 mt-1">{t("subtitle")}</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-navy-light transition-colors"
        >
          <Plus className="w-4 h-4" /> {t("recordSpend", { month: data.month })}
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>}

      <div className="bg-white rounded-xl border p-4">
        <p className="text-sm text-gray-500">{t("ltv.label")}</p>
        <p className="text-2xl font-bold text-brand-ink mt-1">{money(data.ltv.valueCents)}</p>
        <p className="text-xs text-gray-400 mt-1">{data.ltv.formula}</p>
        <p className="text-xs text-gray-400">
          {t("ltv.inputsLine", {
            avgTicket: money(data.ltv.inputs.avgTicketCents),
            frequency: data.ltv.inputs.monthlyFrequency.toFixed(2),
            margin: (data.ltv.inputs.contributionMarginRatio * 100).toFixed(0),
            retentionMonths: data.ltv.inputs.observedRetentionMonths,
          })}
        </p>
        <p className="text-xs text-gray-500 mt-2">
          {t("ltv.suggestedBudgetLine", {
            min: money(data.budgetRange.minCents),
            max: money(data.budgetRange.maxCents),
            revenue: money(data.previousMonthRevenueCents),
          })}
        </p>
      </div>

      {showForm && (
        <form onSubmit={submitSpend} className="bg-white rounded-xl border p-4 space-y-3 max-w-md">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-brand-ink">{t("form.title", { month: data.month })}</h2>
            <button type="button" onClick={() => setShowForm(false)} aria-label={t("form.closeAria")} className="text-gray-400 hover:text-gray-600">
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
          <input
            aria-label={t("form.channelAria")}
            type="text"
            placeholder={t("form.channelPlaceholder")}
            value={form.channel}
            onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value }))}
            className="w-full border rounded-lg px-3 py-2 text-sm"
            required
          />
          <input
            aria-label={t("form.spendAria")}
            type="number"
            min={0}
            step="0.01"
            placeholder={t("form.spendPlaceholder")}
            value={form.spendDollars}
            onChange={(e) => setForm((f) => ({ ...f, spendDollars: e.target.value }))}
            className="w-full border rounded-lg px-3 py-2 text-sm"
            required
          />
          <textarea
            aria-label={t("form.notesAria")}
            placeholder={t("form.notesPlaceholder")}
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            className="w-full border rounded-lg px-3 py-2 text-sm"
            rows={2}
          />
          <button
            aria-label={t("form.saveAria")}
            type="submit"
            disabled={saving}
            className="bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {saving ? t("form.saving") : t("form.save")}
          </button>
        </form>
      )}

      <div className="bg-white rounded-xl border divide-y">
        {data.channels.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">
            <TrendingUp className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            {t("emptyState")}
          </div>
        ) : (
          data.channels.map((c) => (
            <div key={c.channel} className="p-4 flex items-center justify-between">
              <div>
                <p className="font-medium text-brand-ink text-sm">{c.channel}</p>
                <p className="text-xs text-gray-500">
                  {t("channelRow.newCustomers", { count: c.newCustomers, spend: money(c.spendCents) })}
                </p>
                <p className="text-xs text-gray-400">{t("channelRow.suggestedBudget", { amount: money(c.suggestedBudgetCents) })}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium text-brand-ink">{t("channelRow.cac", { amount: money(c.cacCents) })}</p>
                <span
                  className={`inline-flex items-center gap-1 text-xs font-medium ${
                    c.cacHealthy ? "text-state-success" : "text-state-danger"
                  }`}
                >
                  {c.cacHealthy ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                  {c.cacHealthy ? t("channelRow.cacHealthy") : t("channelRow.cacUnhealthy")}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

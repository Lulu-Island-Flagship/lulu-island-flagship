"use client";

import React, { useEffect, useState } from "react";
import { Loader2, TrendingUp, Plus, X, CheckCircle2, AlertTriangle } from "lucide-react";

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
  const [data, setData] = useState<AttributionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ channel: "", spendDollars: "", notes: "" });

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/attribution", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to load");
        return;
      }
      setData(await res.json());
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

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
        setError(err.error || "Failed to save");
        return;
      }
      setShowForm(false);
      setForm({ channel: "", spendDollars: "", notes: "" });
      await load();
    } catch {
      setError("Network error");
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
          <h1 className="text-2xl font-bold text-brand-ink">Attribution — CAC / LTV</h1>
          <p className="text-sm text-gray-500 mt-1">
            No real ad-platform integration — spend is recorded by hand, same as the manual competitor checklist.
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-navy-light transition-colors"
        >
          <Plus className="w-4 h-4" /> Record Spend ({data.month})
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>}

      <div className="bg-white rounded-xl border p-4">
        <p className="text-sm text-gray-500">LTV (global, D.3 formula — never shown without it)</p>
        <p className="text-2xl font-bold text-brand-ink mt-1">{money(data.ltv.valueCents)}</p>
        <p className="text-xs text-gray-400 mt-1">{data.ltv.formula}</p>
        <p className="text-xs text-gray-400">
          avg ticket {money(data.ltv.inputs.avgTicketCents)} × {data.ltv.inputs.monthlyFrequency.toFixed(2)}/mo ×{" "}
          {(data.ltv.inputs.contributionMarginRatio * 100).toFixed(0)}% margin ×{" "}
          {data.ltv.inputs.observedRetentionMonths}mo retention (conservative assumption pending real cohort data)
        </p>
        <p className="text-xs text-gray-500 mt-2">
          Suggested marketing budget this month: {money(data.budgetRange.minCents)} – {money(data.budgetRange.maxCents)}{" "}
          (8-10% of last month's revenue {money(data.previousMonthRevenueCents)})
        </p>
      </div>

      {showForm && (
        <form onSubmit={submitSpend} className="bg-white rounded-xl border p-4 space-y-3 max-w-md">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-brand-ink">Record spend — {data.month}</h2>
            <button type="button" onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">
              <X className="w-5 h-5" />
            </button>
          </div>
          <input
            aria-label="Canal de marketing (ej. google_search)"
            type="text"
            placeholder="Channel (e.g. google_search)"
            value={form.channel}
            onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value }))}
            className="w-full border rounded-lg px-3 py-2 text-sm"
            required
          />
          <input
            aria-label="Gasto de este mes en dólares"
            type="number"
            min={0}
            step="0.01"
            placeholder="Spend this month ($)"
            value={form.spendDollars}
            onChange={(e) => setForm((f) => ({ ...f, spendDollars: e.target.value }))}
            className="w-full border rounded-lg px-3 py-2 text-sm"
            required
          />
          <textarea
            aria-label="Notas sobre el gasto de atribución"
            placeholder="Notes (optional)"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            className="w-full border rounded-lg px-3 py-2 text-sm"
            rows={2}
          />
          <button
            aria-label="Guardar gasto de atribución"
            type="submit"
            disabled={saving}
            className="bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </form>
      )}

      <div className="bg-white rounded-xl border divide-y">
        {data.channels.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">
            <TrendingUp className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            No channel data yet — record spend and wait for quotes with "how did you hear about us" answered.
          </div>
        ) : (
          data.channels.map((c) => (
            <div key={c.channel} className="p-4 flex items-center justify-between">
              <div>
                <p className="font-medium text-brand-ink text-sm">{c.channel}</p>
                <p className="text-xs text-gray-500">
                  {c.newCustomers} new customers (90d) · spend {money(c.spendCents)} this month
                </p>
                <p className="text-xs text-gray-400">Suggested budget: {money(c.suggestedBudgetCents)}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium text-brand-ink">CAC {money(c.cacCents)}</p>
                <span
                  className={`inline-flex items-center gap-1 text-xs font-medium ${
                    c.cacHealthy ? "text-state-success" : "text-state-danger"
                  }`}
                >
                  {c.cacHealthy ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                  {c.cacHealthy ? "CAC < LTV/3" : "CAC too high"}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

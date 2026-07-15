"use client";

import React, { useEffect, useState } from "react";
import { Loader2, Sparkles, CheckCircle2, XCircle, Send, CloudRain } from "lucide-react";

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

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const STATUS_STYLE: Record<Run["status"], string> = {
  suggested: "bg-blue-50 text-blue-700",
  approved: "bg-green-50 text-green-700",
  rejected: "bg-gray-100 text-gray-500",
  dispatched: "bg-purple-50 text-purple-700",
};

export default function SeasonalCampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [evaluating, setEvaluating] = useState(false);
  const [acting, setActing] = useState<string | null>(null);

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
        setError(err.error || "Failed to load");
        return;
      }
      const data = await res.json();
      setCampaigns(data.campaigns || []);
      setRuns(data.runs || []);
    } catch {
      setError("Network error");
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
        setError(err.error || "Failed to evaluate");
        return;
      }
      await load();
    } catch {
      setError("Network error");
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
        setError(err.error || "Failed");
        return;
      }
      await load();
    } catch {
      setError("Network error");
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
        <h1 className="text-2xl font-bold text-brand-ink">Seasonal Campaigns</h1>
        <p className="text-sm text-gray-500 mt-1">
          The 5 pre-loaded campaigns (D.10.4). The suggested month is a hint — the actual trigger is modulated by
          demand signals. There is no live weather feed yet, so enter today&apos;s signals manually.
        </p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        {campaigns.map((c) => (
          <div key={c.campaign_key} className="bg-white rounded-xl border p-3">
            <p className="font-medium text-brand-ink text-sm">{c.display_name}</p>
            <p className="text-xs text-gray-400 mt-1">Suggested: {MONTH_NAMES[c.suggested_month]}</p>
            <p className="text-xs text-gray-500 mt-2">{c.description}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border p-4 space-y-3">
        <h2 className="font-semibold text-brand-ink flex items-center gap-2">
          <CloudRain className="w-4 h-4 text-brand-wave-blue" />
          Today&apos;s demand signals
        </h2>
        <div className="flex flex-wrap gap-3 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={signals.isRainy} onChange={(e) => setSignals((s) => ({ ...s, isRainy: e.target.checked }))} />
            Rainy (+30%)
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={signals.hasLocalEvent} onChange={(e) => setSignals((s) => ({ ...s, hasLocalEvent: e.target.checked }))} />
            Local event (−20%)
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={signals.isSchoolVacation} onChange={(e) => setSignals((s) => ({ ...s, isSchoolVacation: e.target.checked }))} />
            School vacation (−30%)
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={signals.highPollen} onChange={(e) => setSignals((s) => ({ ...s, highPollen: e.target.checked }))} />
            High pollen (+25%)
          </label>
          <select
            value={signals.holiday}
            onChange={(e) => setSignals((s) => ({ ...s, holiday: e.target.value as typeof signals.holiday }))}
            className="border rounded-lg px-2 py-1 text-sm"
          >
            <option value="">No holiday</option>
            <option value="mothers_day">Mother&apos;s Day (+40%)</option>
            <option value="christmas">Christmas (+50%)</option>
          </select>
        </div>
        <button
          onClick={evaluate}
          disabled={evaluating}
          className="inline-flex items-center gap-2 bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-navy-light transition-colors disabled:opacity-50"
        >
          {evaluating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          Evaluate all 5 campaigns
        </button>
      </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="px-4 py-3 border-b font-semibold text-brand-ink text-sm">Evaluations</div>
        {runs.length === 0 ? (
          <p className="text-sm text-gray-400 p-4">No evaluations yet.</p>
        ) : (
          <div className="divide-y">
            {runs.map((run) => (
              <div key={run.id} className="p-4 flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-brand-ink text-sm">{run.campaign_key}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLE[run.status]}`}>{run.status}</span>
                    {run.should_trigger && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">
                        {run.multiplier}x — recommends trigger
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
                      <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                    </button>
                    <button
                      onClick={() => act(run.id, "reject")}
                      disabled={acting === run.id}
                      className="inline-flex items-center gap-1 text-xs text-state-danger hover:underline disabled:opacity-50"
                    >
                      <XCircle className="w-3.5 h-3.5" /> Reject
                    </button>
                  </div>
                )}
                {run.status === "approved" && (
                  <button
                    onClick={() => act(run.id, "dispatch")}
                    disabled={acting === run.id}
                    className="inline-flex items-center gap-1 text-xs text-brand-wave-blue hover:underline disabled:opacity-50 shrink-0"
                  >
                    <Send className="w-3.5 h-3.5" /> Mark dispatched
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

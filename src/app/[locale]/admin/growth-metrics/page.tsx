"use client";

import React, { useEffect, useState } from "react";
import { Loader2, TrendingUp, CheckCircle2, XCircle } from "lucide-react";

interface GrowthMetrics {
  periodDays: number;
  funnel: { conversionRatePercent: number; stage: "below_target" | "acceptable" | "excellent" };
  referral: { referralRatePercent: number; meetsTarget: boolean };
  churn: { churnRatePercent: number; meetsTarget: boolean; activeClientsBeforePeriod: number; churnedClients: number };
  nps: { npsScore: number; promoters: number; passives: number; detractors: number; totalResponses: number; meetsTarget: boolean };
  note: string;
}

const FUNNEL_STAGE_STYLE: Record<string, { label: string; className: string }> = {
  below_target: { label: "Below target (needs >15%)", className: "text-state-danger bg-red-50" },
  acceptable: { label: "Acceptable (>15%)", className: "text-amber-600 bg-amber-50" },
  excellent: { label: "Excellent (>25%)", className: "text-state-success bg-green-50" },
};

function TargetBadge({ meets }: { meets: boolean }) {
  return meets ? (
    <span className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded bg-green-50 text-state-success">
      <CheckCircle2 className="w-3.5 h-3.5" /> Meets target
    </span>
  ) : (
    <span className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded bg-red-50 text-state-danger">
      <XCircle className="w-3.5 h-3.5" /> Below target
    </span>
  );
}

export default function GrowthMetricsPage() {
  const [data, setData] = useState<GrowthMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/growth-metrics", { credentials: "include" });
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
      </div>
    );
  }

  if (error || !data) {
    return <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error || "No data"}</div>;
  }

  const funnelStyle = FUNNEL_STAGE_STYLE[data.funnel.stage];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-ink">Growth Metrics Scorecard</h1>
        <p className="text-sm text-gray-500 mt-1">
          Last {data.periodDays} days (D.10.13). Targets: funnel &gt;15%/25%, CAC&lt;LTV/3, churn&lt;10%, NPS&gt;50, referrals&gt;20%.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border p-5 space-y-2">
          <p className="text-xs text-gray-400 uppercase tracking-wide">Funnel conversion</p>
          <p className="text-3xl font-bold text-brand-ink">{data.funnel.conversionRatePercent}%</p>
          <span className={`inline-block text-xs font-medium px-2 py-1 rounded ${funnelStyle.className}`}>{funnelStyle.label}</span>
        </div>

        <div className="bg-white rounded-xl border p-5 space-y-2">
          <p className="text-xs text-gray-400 uppercase tracking-wide">Referral rate (new clients)</p>
          <p className="text-3xl font-bold text-brand-ink">{data.referral.referralRatePercent}%</p>
          <TargetBadge meets={data.referral.meetsTarget} />
        </div>

        <div className="bg-white rounded-xl border p-5 space-y-2">
          <p className="text-xs text-gray-400 uppercase tracking-wide">Churn rate</p>
          <p className="text-3xl font-bold text-brand-ink">{data.churn.churnRatePercent}%</p>
          <TargetBadge meets={data.churn.meetsTarget} />
          <p className="text-xs text-gray-400">
            {data.churn.churnedClients} signals / {data.churn.activeClientsBeforePeriod} active clients
          </p>
        </div>

        <div className="bg-white rounded-xl border p-5 space-y-2">
          <p className="text-xs text-gray-400 uppercase tracking-wide">NPS</p>
          <p className="text-3xl font-bold text-brand-ink">{data.nps.npsScore}</p>
          <TargetBadge meets={data.nps.meetsTarget} />
          <p className="text-xs text-gray-400">
            {data.nps.promoters} promoters · {data.nps.passives} passives · {data.nps.detractors} detractors ({data.nps.totalResponses} responses)
          </p>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 text-sm text-blue-800 flex items-start gap-2">
        <TrendingUp className="w-4 h-4 shrink-0 mt-0.5" />
        {data.note}
      </div>
    </div>
  );
}

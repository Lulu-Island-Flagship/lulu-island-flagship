"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Loader2, TrendingUp, CheckCircle2, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";

interface GrowthMetrics {
  periodDays: number;
  funnel: { conversionRatePercent: number; stage: "below_target" | "acceptable" | "excellent" };
  referral: { referralRatePercent: number; meetsTarget: boolean };
  churn: { churnRatePercent: number; meetsTarget: boolean; activeClientsBeforePeriod: number; churnedClients: number };
  nps: { npsScore: number; promoters: number; passives: number; detractors: number; totalResponses: number; meetsTarget: boolean };
  note: string;
}

function TargetBadge({ meets, t }: { meets: boolean; t: ReturnType<typeof useTranslations> }) {
  return meets ? (
    <span className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded bg-green-50 text-state-success">
      <CheckCircle2 className="w-3.5 h-3.5" /> {t("meetsTarget")}
    </span>
  ) : (
    <span className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded bg-red-50 text-state-danger">
      <XCircle className="w-3.5 h-3.5" /> {t("belowTarget")}
    </span>
  );
}

export default function GrowthMetricsPage() {
  const t = useTranslations("admin.growthMetrics");
  const [data, setData] = useState<GrowthMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/growth-metrics", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("errorLoading"));
        return;
      }
      setData(await res.json());
    } catch {
      setError(t("errorNetwork"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold-dark" />
      </div>
    );
  }

  if (error || !data) {
    return <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error || t("noData")}</div>;
  }

  const funnelStyle: Record<string, string> = {
    below_target: "text-state-danger bg-red-50",
    acceptable: "text-amber-600 bg-amber-50",
    excellent: "text-state-success bg-green-50",
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-ink">{t("title")}</h1>
        <p className="text-sm text-gray-500 mt-1">{t("subtitle", { days: data.periodDays })}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border p-5 space-y-2">
          <p className="text-xs text-gray-400 uppercase tracking-wide">{t("funnelConversion")}</p>
          <p className="text-3xl font-bold text-brand-ink">{data.funnel.conversionRatePercent}%</p>
          <span className={`inline-block text-xs font-medium px-2 py-1 rounded ${funnelStyle[data.funnel.stage]}`}>
            {t(`funnelStage.${data.funnel.stage}`)}
          </span>
        </div>

        <div className="bg-white rounded-xl border p-5 space-y-2">
          <p className="text-xs text-gray-400 uppercase tracking-wide">{t("referralRate")}</p>
          <p className="text-3xl font-bold text-brand-ink">{data.referral.referralRatePercent}%</p>
          <TargetBadge meets={data.referral.meetsTarget} t={t} />
        </div>

        <div className="bg-white rounded-xl border p-5 space-y-2">
          <p className="text-xs text-gray-400 uppercase tracking-wide">{t("churnRate")}</p>
          <p className="text-3xl font-bold text-brand-ink">{data.churn.churnRatePercent}%</p>
          <TargetBadge meets={data.churn.meetsTarget} t={t} />
          <p className="text-xs text-gray-400">
            {t("churnDetail", { signals: data.churn.churnedClients, active: data.churn.activeClientsBeforePeriod })}
          </p>
        </div>

        <div className="bg-white rounded-xl border p-5 space-y-2">
          <p className="text-xs text-gray-400 uppercase tracking-wide">{t("nps")}</p>
          <p className="text-3xl font-bold text-brand-ink">{data.nps.npsScore}</p>
          <TargetBadge meets={data.nps.meetsTarget} t={t} />
          <p className="text-xs text-gray-400">
            {t("npsDetail", {
              promoters: data.nps.promoters,
              passives: data.nps.passives,
              detractors: data.nps.detractors,
              responses: data.nps.totalResponses,
            })}
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

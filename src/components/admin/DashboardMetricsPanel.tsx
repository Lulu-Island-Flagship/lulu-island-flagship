"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, TrendingUp, HelpCircle } from "lucide-react";
import { SkeletonMetricsGrid } from "@/components/ui/Skeleton";

type Semaphore = "green" | "yellow" | "red" | "unknown";

interface MetricCommon {
  semaphore: Semaphore;
}

interface DashboardMetricsResponse {
  windowStart: string;
  windowEnd: string;
  metrics: {
    disputeFreeRate: MetricCommon & {
      valuePercent: number | null;
      thresholdPercent: number;
      completedServicesCount: number;
      servicesWithDisputeCount: number;
    };
    batchCaptureSuccessRate: MetricCommon & {
      valuePercent: number | null;
      thresholdPercent: number;
      successfulCaptureCount: number;
      failedCaptureCount: number;
    };
    teamScoreAverage: MetricCommon & {
      value: number | null;
      threshold: number;
      weekStart: string | null;
    };
    contributionMargin: MetricCommon & {
      valuePercent: number | null;
      thresholdPercent: number;
    };
    netMargin: MetricCommon & {
      valuePercent: number | null;
      thresholdPercent: number;
      fixedCostPerServiceDollars: number | null;
      fixedCostsConfigured: boolean;
      formula: string;
    };
  };
}

const SEMAPHORE_STYLES: Record<Semaphore, { dot: string; ring: string; text: string }> = {
  green: { dot: "bg-state-success", ring: "border-state-success/30 bg-state-success/5", text: "text-state-success" },
  yellow: { dot: "bg-state-warning", ring: "border-state-warning/30 bg-state-warning/5", text: "text-state-warning" },
  red: { dot: "bg-state-danger", ring: "border-state-danger/30 bg-state-danger/5", text: "text-state-danger" },
  unknown: { dot: "bg-gray-300", ring: "border-gray-200 bg-gray-50", text: "text-gray-400" },
};

function MetricCard({
  title,
  value,
  unit,
  // Se recibe para completitud del contrato de datos pero thresholdLabel ya
  // trae el valor formateado listo para mostrar -- no se usa el número crudo.
  threshold: _threshold,
  thresholdLabel,
  semaphore,
  subtitle,
  formula,
}: {
  title: string;
  value: number | null;
  unit: string;
  threshold: number;
  thresholdLabel: string;
  semaphore: Semaphore;
  subtitle?: string;
  formula?: string;
}) {
  const style = SEMAPHORE_STYLES[semaphore];
  return (
    <div className={`rounded-xl border p-5 ${style.ring}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-600">{title}</h3>
        <span className={`w-2.5 h-2.5 rounded-full ${style.dot}`} title={semaphore} />
      </div>
      <p className={`mt-2 text-3xl font-bold ${style.text}`}>
        {value === null ? "—" : `${value}${unit}`}
      </p>
      <p className="mt-1 text-xs text-gray-400">{thresholdLabel}</p>
      {subtitle && <p className="mt-2 text-xs text-gray-500">{subtitle}</p>}
      {formula && (
        <p className="mt-2 text-[11px] text-gray-400 font-mono leading-snug">{formula}</p>
      )}
    </div>
  );
}

/**
 * v8.3 D.13 — panel de las "4+1" métricas del dueño. Ventana móvil de 30
 * días para las 4 operativas; margen neto real usa el mes calendario en
 * curso (los costos fijos son mensuales por definición).
 */
export default function DashboardMetricsPanel() {
  const t = useTranslations("admin.dashboardMetrics");
  const [data, setData] = useState<DashboardMetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingFixedCosts, setEditingFixedCosts] = useState(false);
  const [fixedCostsInput, setFixedCostsInput] = useState("");
  const [savingFixedCosts, setSavingFixedCosts] = useState(false);
  const [fixedCostsError, setFixedCostsError] = useState("");

  const loadMetrics = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/dashboard-metrics", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("loadError"));
        return;
      }
      setData(await res.json());
    } catch {
      setError(t("networkError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadMetrics();
  }, [loadMetrics]);

  async function saveFixedCosts() {
    const dollars = Number(fixedCostsInput);
    if (Number.isNaN(dollars) || dollars < 0) {
      setFixedCostsError(t("fixedCosts.invalidAmount"));
      return;
    }
    setSavingFixedCosts(true);
    setFixedCostsError("");
    try {
      const res = await fetch("/api/admin/fixed-costs-settings", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          monthlyFixedCostsDollars: dollars,
          reason: "Updated from owner dashboard",
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || t("fixedCosts.saveError"));
      }
      setEditingFixedCosts(false);
      await loadMetrics();
    } catch (err) {
      setFixedCostsError(err instanceof Error ? err.message : t("fixedCosts.saveError"));
    } finally {
      setSavingFixedCosts(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-brand-wave-blue" />
          <h2 className="text-sm font-semibold text-brand-ink">
            {t("title")}
          </h2>
        </div>
        <SkeletonMetricsGrid count={5} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-2 text-sm">
        <AlertCircle className="w-4 h-4 text-red-500" />
        <span className="text-red-700">{error || t("noData")}</span>
      </div>
    );
  }

  const { metrics } = data;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-brand-wave-blue" />
        <h2 className="text-sm font-semibold text-brand-ink">
          {t("title")}
        </h2>
        <span
          title={t("thresholdsTooltip")}
          className="text-gray-300"
        >
          <HelpCircle className="w-3.5 h-3.5" />
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <MetricCard
          title={t("cards.disputeFreeRate.title")}
          value={metrics.disputeFreeRate.valuePercent}
          unit="%"
          threshold={metrics.disputeFreeRate.thresholdPercent}
          thresholdLabel={t("target", { threshold: metrics.disputeFreeRate.thresholdPercent })}
          semaphore={metrics.disputeFreeRate.semaphore}
          subtitle={t("cards.disputeFreeRate.subtitle", {
            completed: metrics.disputeFreeRate.completedServicesCount,
            disputed: metrics.disputeFreeRate.servicesWithDisputeCount,
          })}
        />
        <MetricCard
          title={t("cards.batchCapture.title")}
          value={metrics.batchCaptureSuccessRate.valuePercent}
          unit="%"
          threshold={metrics.batchCaptureSuccessRate.thresholdPercent}
          thresholdLabel={t("target", { threshold: metrics.batchCaptureSuccessRate.thresholdPercent })}
          semaphore={metrics.batchCaptureSuccessRate.semaphore}
          subtitle={t("cards.batchCapture.subtitle", {
            captured: metrics.batchCaptureSuccessRate.successfulCaptureCount,
            failed: metrics.batchCaptureSuccessRate.failedCaptureCount,
          })}
        />
        <MetricCard
          title={t("cards.teamScore.title")}
          value={metrics.teamScoreAverage.value}
          unit=""
          threshold={metrics.teamScoreAverage.threshold}
          thresholdLabel={t("targetPlain", { threshold: metrics.teamScoreAverage.threshold })}
          semaphore={metrics.teamScoreAverage.semaphore}
          subtitle={metrics.teamScoreAverage.weekStart ? t("cards.teamScore.weekOf", { week: metrics.teamScoreAverage.weekStart }) : t("cards.teamScore.noScores")}
        />
        <MetricCard
          title={t("cards.contributionMargin.title")}
          value={metrics.contributionMargin.valuePercent}
          unit="%"
          threshold={metrics.contributionMargin.thresholdPercent}
          thresholdLabel={t("target", { threshold: metrics.contributionMargin.thresholdPercent })}
          semaphore={metrics.contributionMargin.semaphore}
        />
        <div className={`rounded-xl border p-5 ${SEMAPHORE_STYLES[metrics.netMargin.semaphore].ring}`}>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-gray-600">{t("cards.netMargin.title")}</h3>
            <span
              className={`w-2.5 h-2.5 rounded-full ${SEMAPHORE_STYLES[metrics.netMargin.semaphore].dot}`}
              title={metrics.netMargin.semaphore}
            />
          </div>
          <p className={`mt-2 text-3xl font-bold ${SEMAPHORE_STYLES[metrics.netMargin.semaphore].text}`}>
            {metrics.netMargin.valuePercent === null ? "—" : `${metrics.netMargin.valuePercent}%`}
          </p>
          <p className="mt-1 text-xs text-gray-400">
            {metrics.netMargin.fixedCostsConfigured
              ? t("target", { threshold: metrics.netMargin.thresholdPercent })
              : t("cards.netMargin.notConfigured")}
          </p>
          {metrics.netMargin.fixedCostPerServiceDollars !== null && (
            <p className="mt-2 text-xs text-gray-500">
              {t("cards.netMargin.fixedCostPerService", { amount: metrics.netMargin.fixedCostPerServiceDollars })}
            </p>
          )}
          <p className="mt-2 text-[11px] text-gray-400 font-mono leading-snug">{metrics.netMargin.formula}</p>

          {editingFixedCosts ? (
            <div className="mt-3 space-y-2">
              <label htmlFor="dashboard-fixed-costs" className="text-xs text-gray-500 block">{t("fixedCosts.label")}</label>
              <input
                id="dashboard-fixed-costs"
                type="number"
                min={0}
                step="0.01"
                value={fixedCostsInput}
                onChange={(e) => setFixedCostsInput(e.target.value)}
                className="w-full px-2 py-1 text-sm border rounded-md"
                placeholder={t("fixedCosts.placeholder")}
              />
              {fixedCostsError && <p className="text-xs text-state-danger">{fixedCostsError}</p>}
              <div className="flex gap-2">
                <button
                  onClick={saveFixedCosts}
                  disabled={savingFixedCosts}
                  aria-label={savingFixedCosts ? t("fixedCosts.savingAriaLabel") : t("fixedCosts.saveAriaLabel")}
                  className="text-xs px-3 py-1 rounded-md bg-brand-navy text-white hover:bg-brand-navy-light disabled:opacity-50"
                >
                  {savingFixedCosts ? t("fixedCosts.saving") : t("fixedCosts.save")}
                </button>
                <button
                  onClick={() => setEditingFixedCosts(false)}
                  className="text-xs px-3 py-1 rounded-md text-gray-500 hover:bg-gray-100"
                >
                  {t("fixedCosts.cancel")}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => {
                setFixedCostsInput("");
                setFixedCostsError("");
                setEditingFixedCosts(true);
              }}
              className="mt-3 text-xs text-brand-wave-blue hover:text-brand-navy underline"
            >
              {metrics.netMargin.fixedCostsConfigured ? t("fixedCosts.update") : t("fixedCosts.set")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import React, { useState, useEffect, useCallback } from "react";
import { AlertTriangle, Loader2, ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";

// v8.3 E7 (D.7.8) — Dashboard semanal de near-misses (casi-accidentes).
// Reporte sin penalización, anonimato opcional: esta pantalla NUNCA muestra
// quién reportó — solo cuenta agregado por categoría + acción sugerida.
// Nunca visible al cliente (solo bajo /admin).

interface WeeklyPattern {
  category: "near_fall" | "near_chemical_mix" | "near_bite" | "near_burn" | "other";
  count: number;
  suggestedAction: string;
}

export default function NearMissesPage() {
  const t = useTranslations("admin.nearMisses");
  const CATEGORY_LABELS: Record<WeeklyPattern["category"], string> = {
    near_fall: t("category.nearFall"),
    near_chemical_mix: t("category.nearChemicalMix"),
    near_bite: t("category.nearBite"),
    near_burn: t("category.nearBurn"),
    other: t("category.other"),
  };
  const [weekStart, setWeekStart] = useState<string>("");
  const [weekEndExclusive, setWeekEndExclusive] = useState<string>("");
  const [totalReports, setTotalReports] = useState(0);
  const [patterns, setPatterns] = useState<WeeklyPattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (weekStartParam?: string) => {
    setLoading(true);
    setError("");
    try {
      const url = weekStartParam
        ? `/api/admin/near-misses?weekStart=${weekStartParam}`
        : "/api/admin/near-misses";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("errorLoading"));
        return;
      }
      const data = await res.json();
      setWeekStart(data.weekStart);
      setWeekEndExclusive(data.weekEndExclusive);
      setTotalReports(data.totalReports || 0);
      setPatterns(data.patterns || []);
    } catch {
      setError(t("errorNetwork"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  function changeWeek(deltaDays: number) {
    const d = new Date(weekStart + "T12:00:00Z");
    d.setDate(d.getDate() + deltaDays);
    const newWeekStart = d.toISOString().split("T")[0];
    load(newWeekStart);
  }

  return (
    <main className="min-h-screen bg-brand-ice">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="flex items-center gap-2 mb-1">
          <ShieldAlert className="w-5 h-5 text-brand-navy" />
          <h1 className="text-xl font-bold text-brand-ink">{t("title")}</h1>
        </div>
        <p className="text-sm text-gray-600 mb-6">{t("subtitle")}</p>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700 mb-4">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => changeWeek(-7)}
            disabled={loading || !weekStart}
            className="text-sm text-brand-navy font-medium disabled:opacity-40"
          >
            {t("previousWeek")}
          </button>
          <span className="text-sm text-gray-600">
            {weekStart && weekEndExclusive
              ? `${weekStart} → ${weekEndExclusive}`
              : ""}
          </span>
          <button
            onClick={() => changeWeek(7)}
            disabled={loading || !weekStart}
            className="text-sm text-brand-navy font-medium disabled:opacity-40"
          >
            {t("nextWeek")}
          </button>
        </div>

        {loading ? (
          <Loader2 className="w-6 h-6 animate-spin text-brand-gold" />
        ) : (
          <>
            <div className="bg-white rounded-xl shadow-elevation-1 p-4 mb-4">
              <p className="text-sm text-gray-500">{t("totalReportedThisWeek")}</p>
              <p className="text-2xl font-bold text-brand-ink">{totalReports}</p>
            </div>

            <div className="bg-white rounded-xl shadow-elevation-1 divide-y">
              {patterns.length === 0 && (
                <p className="p-4 text-sm text-gray-500">{t("noReports")}</p>
              )}
              {patterns.map((p) => (
                <div key={p.category} className="p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-brand-ink flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-state-warning" />
                      {CATEGORY_LABELS[p.category]}
                    </span>
                    <span className="text-gray-500">{t("reportCount", { count: p.count })}</span>
                  </div>
                  <p className="text-xs text-gray-600 mt-1">{p.suggestedAction}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

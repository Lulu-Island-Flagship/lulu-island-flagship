"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Swords, Loader2, AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";

interface Snapshot {
  price_cents: number;
  services: string[];
  active_promotions: string[];
  average_rating: number;
  review_count: number;
  captured_at: string;
  source: "manual_checklist" | "scraping";
}

interface MarginComparison {
  ourPriceCents: number;
  ourMarginPercent: number;
  marginIfMatchedPercent: number;
  recommendation: "maintain" | "reconsider";
  message: string;
}

interface CompetitorRow {
  id: string;
  name: string;
  zone: string;
  notes: string | null;
  latestSnapshot: Snapshot | null;
  marginComparison: MarginComparison | null;
}

interface Alert {
  id: string;
  competitor_id: string;
  alert_type: string;
  severity: "info" | "warning";
  reason: string;
  created_at: string;
}

interface CompetenciaResponse {
  competitors: CompetitorRow[];
  activeCount: number;
  unacknowledgedAlerts: Alert[];
}

function formatCad(cents: number): string {
  return (cents / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
}

export default function CompetenciaPage() {
  const t = useTranslations("admin.competencia");
  const [data, setData] = useState<CompetenciaResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/competencia");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || t("errors.loadFailed"));
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.unknown"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <Swords className="w-6 h-6" />
        <h1 className="text-2xl font-bold">{t("title")}</h1>
      </div>

      <p className="text-sm text-gray-500 mb-6">
        {t.rich("subtitle", { code: (chunks) => <code>{chunks}</code> })}
      </p>

      {loading && (
        <div className="flex items-center gap-2 text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" /> {t("loading")}
        </div>
      )}
      {error && <div className="text-red-600 text-sm mb-4">{error}</div>}

      {data && !loading && (
        <>
          {data.unacknowledgedAlerts.length > 0 && (
            <div className="mb-6 space-y-2">
              {data.unacknowledgedAlerts.map((a) => (
                <div
                  key={a.id}
                  className={`flex items-start gap-2 rounded p-3 text-sm border ${
                    a.severity === "warning" ? "bg-amber-50 border-amber-200" : "bg-blue-50 border-blue-200"
                  }`}
                >
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>{a.reason}</span>
                </div>
              ))}
            </div>
          )}

          <div className="text-xs text-gray-400 mb-3">{t("activeCount", { count: data.activeCount })}</div>

          <div className="overflow-x-auto rounded border border-gray-200">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left">{t("table.competitor")}</th>
                  <th scope="col" className="px-3 py-2 text-left">{t("table.zone")}</th>
                  <th scope="col" className="px-3 py-2 text-right">{t("table.price")}</th>
                  <th scope="col" className="px-3 py-2 text-right">{t("table.rating")}</th>
                  <th scope="col" className="px-3 py-2 text-right">{t("table.reviews")}</th>
                  <th scope="col" className="px-3 py-2 text-left">{t("table.lastCapture")}</th>
                </tr>
              </thead>
              <tbody>
                {data.competitors.map((c) => (
                  <React.Fragment key={c.id}>
                    <tr className="border-t border-gray-100">
                      <td className="px-3 py-2">{c.name}</td>
                      <td className="px-3 py-2">{c.zone}</td>
                      <td className="px-3 py-2 text-right">
                        {c.latestSnapshot ? formatCad(c.latestSnapshot.price_cents) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right">{c.latestSnapshot?.average_rating ?? "—"}</td>
                      <td className="px-3 py-2 text-right">{c.latestSnapshot?.review_count ?? "—"}</td>
                      <td className="px-3 py-2 text-gray-400">
                        {c.latestSnapshot ? new Date(c.latestSnapshot.captured_at).toLocaleDateString("en-CA") : t("noData")}
                      </td>
                    </tr>
                    {c.marginComparison && (
                      <tr className="border-t border-gray-100 bg-gray-50/50">
                        <td colSpan={6} className="px-3 py-2 text-xs">
                          <span
                            className={
                              c.marginComparison.recommendation === "reconsider"
                                ? "text-amber-700 font-medium"
                                : "text-gray-500"
                            }
                          >
                            {c.marginComparison.message}
                          </span>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
                {data.competitors.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-center text-gray-400">
                      {t("noCompetitors")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

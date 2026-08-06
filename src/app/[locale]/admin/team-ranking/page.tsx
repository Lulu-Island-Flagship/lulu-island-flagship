"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Trophy, Loader2 } from "lucide-react";

interface TeamRankingEntry {
  rank: 1 | 2 | 3;
  teamId: string;
  teamName: string;
  compositeScore: number;
}

interface TeamRankingResponse {
  weekStart: string;
  top3: TeamRankingEntry[];
}

const MEDAL: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

export default function TeamRankingPage() {
  const t = useTranslations("admin.teamRanking");
  const [data, setData] = useState<TeamRankingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [weekStart, setWeekStart] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (weekStart) params.set("week_start", weekStart);
      const res = await fetch(`/api/admin/team-ranking?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || t("errors.loadFailed"));
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.unknown"));
    } finally {
      setLoading(false);
    }
  }, [t, weekStart]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <Trophy className="w-6 h-6" />
        <h1 className="text-2xl font-bold">{t("title")}</h1>
      </div>

      <p className="text-sm text-gray-500 mb-4">{t("subtitle")}</p>

      <div className="flex items-end gap-3 mb-6">
        <div>
          <label htmlFor="team-ranking-week-start" className="block text-xs text-gray-500 mb-1">{t("weekLabel")}</label>
          <input
            id="team-ranking-week-start"
            type="date"
            value={weekStart}
            onChange={(e) => setWeekStart(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          />
        </div>
        <button onClick={load} className="px-3 py-1.5 bg-gray-900 text-white rounded text-sm">
          {t("viewWeek")}
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" /> {t("loading")}
        </div>
      )}
      {error && <div className="text-red-600 text-sm mb-4">{error}</div>}

      {data && !loading && (
        <>
          <div className="text-xs text-gray-400 mb-3">{t("weekOf", { date: data.weekStart })}</div>
          {data.top3.length === 0 ? (
            <div className="text-gray-400 text-sm">{t("noScores")}</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {data.top3.map((entry) => (
                <div key={entry.teamId} className="border rounded-xl p-5 text-center shadow-sm">
                  <div className="text-3xl mb-1">{MEDAL[entry.rank]}</div>
                  <div className="text-lg font-semibold">{entry.teamName}</div>
                  <div className="text-sm text-gray-500">{t("score", { value: entry.compositeScore.toFixed(1) })}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

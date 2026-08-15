"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Moon, Smile, Meh, Frown, Calendar } from "lucide-react";

interface Aggregate {
  checkin_date: string;
  total_checkins: number;
  slept_less_than_6h_count: number;
  mood_happy_count: number;
  mood_neutral_count: number;
  mood_sad_count: number;
}

function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

/**
 * v8.3 E8.1/E8.3 — Ánimo y sueño agregados, NUNCA individual. La API
 * (/api/admin/wellbeing) y la función SQL (get_wellbeing_aggregate,
 * migración 049) ya existían y ya están correctamente bloqueadas a nivel de
 * RLS para que sea imposible leer una fila individual; solo faltaba esta
 * pantalla para que el admin realmente lo viera.
 */
export default function WellbeingPage() {
  const t = useTranslations("admin.wellbeing");
  const [date, setDate] = useState(todayStr());
  const [aggregate, setAggregate] = useState<Aggregate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (d: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/wellbeing?date=${d}`, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("errors.loadFailed"));
        return;
      }
      const data = await res.json();
      setAggregate(data.aggregate || null);
    } catch {
      setError(t("errors.network"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load(date);
  }, [date, load]);

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-brand-ink">{t("title")}</h1>
        <p className="text-sm text-gray-500 mt-1">{t("description")}</p>
      </div>

      <div className="flex items-center gap-2">
        <Calendar className="w-4 h-4 text-gray-400" />
        <input
          type="date"
          aria-label={t("dateAria")}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm"
        />
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-brand-gold-dark" />
        </div>
      ) : !aggregate || aggregate.total_checkins === 0 ? (
        <div className="bg-white rounded-xl border p-8 text-center text-sm text-gray-500">
          {t("noCheckins", { date })}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border p-4 text-center">
            <p className="text-2xl font-bold text-brand-ink">{aggregate.total_checkins}</p>
            <p className="text-xs text-gray-500 mt-1">{t("stats.totalCheckins")}</p>
          </div>
          <div className="bg-white rounded-xl border p-4 text-center">
            <Moon className="w-5 h-5 text-brand-wave-blue mx-auto mb-1" />
            <p className="text-2xl font-bold text-brand-ink">{aggregate.slept_less_than_6h_count}</p>
            <p className="text-xs text-gray-500 mt-1">{t("stats.sleptLessThan6h")}</p>
          </div>
          <div className="bg-white rounded-xl border p-4 text-center">
            <Smile className="w-5 h-5 text-state-success mx-auto mb-1" />
            <p className="text-2xl font-bold text-brand-ink">{aggregate.mood_happy_count}</p>
            <p className="text-xs text-gray-500 mt-1">{t("stats.happy")}</p>
          </div>
          <div className="bg-white rounded-xl border p-4 text-center">
            <Meh className="w-5 h-5 text-state-warning mx-auto mb-1" />
            <p className="text-2xl font-bold text-brand-ink">{aggregate.mood_neutral_count}</p>
            <p className="text-xs text-gray-500 mt-1">{t("stats.neutral")}</p>
          </div>
          <div className="bg-white rounded-xl border p-4 text-center col-span-2 sm:col-span-1">
            <Frown className="w-5 h-5 text-state-danger mx-auto mb-1" />
            <p className="text-2xl font-bold text-brand-ink">{aggregate.mood_sad_count}</p>
            <p className="text-xs text-gray-500 mt-1">{t("stats.sad")}</p>
          </div>
        </div>
      )}
    </div>
  );
}

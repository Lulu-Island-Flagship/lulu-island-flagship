"use client";

import React, { useState, useEffect } from "react";
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
  const [date, setDate] = useState(todayStr());
  const [aggregate, setAggregate] = useState<Aggregate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    load(date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  async function load(d: string) {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/wellbeing?date=${d}`, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to load");
        return;
      }
      const data = await res.json();
      setAggregate(data.aggregate || null);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-brand-ink">Team Wellbeing</h1>
        <p className="text-sm text-gray-500 mt-1">
          Aggregated only — no individual check-in is ever readable, not even by owner_admin (RLS-enforced, no
          SELECT policy exists on the underlying table).
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Calendar className="w-4 h-4 text-gray-400" />
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm"
        />
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
        </div>
      ) : !aggregate || aggregate.total_checkins === 0 ? (
        <div className="bg-white rounded-xl border p-8 text-center text-sm text-gray-500">
          No check-ins recorded for {date}.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border p-4 text-center">
            <p className="text-2xl font-bold text-brand-ink">{aggregate.total_checkins}</p>
            <p className="text-xs text-gray-500 mt-1">Total check-ins</p>
          </div>
          <div className="bg-white rounded-xl border p-4 text-center">
            <Moon className="w-5 h-5 text-brand-wave-blue mx-auto mb-1" />
            <p className="text-2xl font-bold text-brand-ink">{aggregate.slept_less_than_6h_count}</p>
            <p className="text-xs text-gray-500 mt-1">Slept &lt;6h</p>
          </div>
          <div className="bg-white rounded-xl border p-4 text-center">
            <Smile className="w-5 h-5 text-state-success mx-auto mb-1" />
            <p className="text-2xl font-bold text-brand-ink">{aggregate.mood_happy_count}</p>
            <p className="text-xs text-gray-500 mt-1">Happy</p>
          </div>
          <div className="bg-white rounded-xl border p-4 text-center">
            <Meh className="w-5 h-5 text-state-warning mx-auto mb-1" />
            <p className="text-2xl font-bold text-brand-ink">{aggregate.mood_neutral_count}</p>
            <p className="text-xs text-gray-500 mt-1">Neutral</p>
          </div>
          <div className="bg-white rounded-xl border p-4 text-center col-span-2 sm:col-span-1">
            <Frown className="w-5 h-5 text-state-danger mx-auto mb-1" />
            <p className="text-2xl font-bold text-brand-ink">{aggregate.mood_sad_count}</p>
            <p className="text-xs text-gray-500 mt-1">Sad</p>
          </div>
        </div>
      )}
    </div>
  );
}

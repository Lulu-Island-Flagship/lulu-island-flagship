"use client";

import React, { useEffect, useState } from "react";
import { Clock, Loader2, CheckCircle2, XCircle } from "lucide-react";

interface RestPeriod {
  id: string;
  work_date: string;
  rest_start_at: string;
  rest_end_at: string;
  duration_minutes: number;
  role_during_rest: "driver" | "passenger" | "solo_no_vehicle";
  satisfies_esa_break: boolean;
  reason: string;
}

/**
 * v8.3 (BC ESA s.32) — Mis descansos documentados. Muestra el tránsito
 * entre servicios y si calificó como el descanso legal de 30 min. Si el
 * rol ese día fue 'driver', nunca cuenta como descanso porque manejar
 * sigue siendo trabajo — se explica en pantalla para que quede claro por
 * qué, no solo el resultado.
 */
export default function DescansosPage() {
  const [periods, setPeriods] = useState<RestPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/empleado/rest-periods", { credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setPeriods(data.periods || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-4 max-w-lg mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <Clock className="w-6 h-6 text-brand-navy" />
        <h1 className="text-xl font-bold text-brand-ink">My Breaks</h1>
      </div>
      <p className="text-sm text-gray-500">
        Your transit time between services, and whether it counted as your legally required 30-min
        break (after 5h of continuous work). If you were driving, that time never counts as a break
        — you&apos;re still working.
      </p>

      {error && <div className="text-red-600 text-sm">{error}</div>}

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="space-y-2">
          {periods.map((p) => (
            <div key={p.id} className="bg-white rounded-lg shadow-elevation-1 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">{p.work_date}</span>
                <span
                  className={`text-xs flex items-center gap-1 ${
                    p.satisfies_esa_break ? "text-state-success" : "text-gray-400"
                  }`}
                >
                  {p.satisfies_esa_break ? (
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5" />
                  )}
                  {p.satisfies_esa_break ? "Counted as break" : "Not a break"}
                </span>
              </div>
              <div className="text-xs text-gray-400 mt-0.5">
                {p.duration_minutes} min transit · {p.role_during_rest}
              </div>
            </div>
          ))}
          {periods.length === 0 && (
            <div className="text-xs text-gray-400">No documented rest periods in the last 30 days.</div>
          )}
        </div>
      )}
    </div>
  );
}

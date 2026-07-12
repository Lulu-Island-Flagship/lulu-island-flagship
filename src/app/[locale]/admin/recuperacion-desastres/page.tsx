"use client";

/**
 * v8.3 E11.3/E11.4 — Recuperación de desastres: RTO declarado (tabla) +
 * historial de simulacros + botón para correr la verificación automática.
 * Consume /api/admin/dr-drill (GET lista, POST corre/registra un simulacro).
 */

import React, { useState, useEffect, useCallback } from "react";
import { ShieldCheck, Loader2, PlayCircle, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";

interface RtoTarget {
  id: string;
  data_type: string;
  rto_hours: number;
  recovery_method: string;
  is_example: boolean;
  source: string;
  notes: string | null;
}

interface Drill {
  id: string;
  drill_type: string;
  tested_scope: string;
  result: "pass" | "fail" | "partial";
  verification_details: Record<string, unknown>;
  duration_seconds: number | null;
  notes: string | null;
  created_at: string;
}

function formatRto(hours: number): string {
  if (hours === 0) return "Immediate";
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 24) return `${hours} h`;
  return `${(hours / 24).toFixed(1)} days`;
}

function ResultBadge({ result }: { result: Drill["result"] }) {
  if (result === "pass") return <span className="flex items-center gap-1 text-xs text-state-success"><CheckCircle2 className="h-3.5 w-3.5" /> pass</span>;
  if (result === "partial") return <span className="flex items-center gap-1 text-xs text-state-warning"><AlertTriangle className="h-3.5 w-3.5" /> partial</span>;
  return <span className="flex items-center gap-1 text-xs text-state-danger"><XCircle className="h-3.5 w-3.5" /> fail</span>;
}

export default function RecuperacionDesastresPage() {
  const [rtoTargets, setRtoTargets] = useState<RtoTarget[]>([]);
  const [drills, setDrills] = useState<Drill[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [scope, setScope] = useState("Current database integrity verification");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/dr-drill");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error loading");
      setRtoTargets(json.rtoTargets);
      setDrills(json.drills);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function runDrill() {
    setRunning(true);
    setError("");
    try {
      const res = await fetch("/api/admin/dr-drill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ drillType: "restore_verification", testedScope: scope }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error running the drill");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-2 flex items-center gap-3">
        <ShieldCheck className="h-6 w-6 text-brand-navy" />
        <h1 className="text-2xl font-semibold text-brand-navy">Disaster Recovery</h1>
      </div>
      <p className="mb-6 text-sm text-gray-500">
        Live backups are managed by Supabase (PITR/snapshots) and the monthly pg_dump to
        cold storage (outside the scope of this app). This screen records
        drills and makes the declared RTO verifiable.
      </p>

      {error && <div className="mb-4 rounded-md border border-state-danger bg-red-50 p-3 text-sm text-state-danger">{error}</div>}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-brand-navy" />
        </div>
      ) : (
        <>
          <h2 className="mb-2 text-lg font-semibold text-brand-ink">Declared RTO by data type</h2>
          <div className="mb-8 overflow-x-auto rounded border border-gray-200">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left">Data type</th>
                  <th className="px-3 py-2 text-left">RTO</th>
                  <th className="px-3 py-2 text-left">Recovery method</th>
                  <th className="px-3 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {rtoTargets.map((t) => (
                  <tr key={t.id} className="border-t border-gray-100">
                    <td className="px-3 py-2">{t.data_type.replace(/_/g, " ")}</td>
                    <td className="px-3 py-2 font-medium">{formatRto(t.rto_hours)}</td>
                    <td className="px-3 py-2 text-gray-600">{t.recovery_method}</td>
                    <td className="px-3 py-2">
                      {t.is_example ? (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                          declared in plan, not confirmed by drill
                        </span>
                      ) : (
                        <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-800">confirmed</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mb-6 flex items-end gap-3 rounded-lg border border-brand-ice bg-white p-4">
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1">What is tested (tested_scope)</label>
              <input
                type="text"
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                className="w-full rounded border px-2 py-1.5 text-sm"
              />
            </div>
            <button
              onClick={runDrill}
              disabled={running}
              className="flex items-center gap-1.5 rounded-md bg-brand-navy px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50"
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
              Run restoration verification
            </button>
          </div>

          <h2 className="mb-2 text-lg font-semibold text-brand-ink">Drill history</h2>
          {drills.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">No drills recorded yet.</p>
          ) : (
            <div className="space-y-2">
              {drills.map((d) => (
                <div key={d.id} className="rounded-lg border border-gray-200 bg-white p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <code className="rounded bg-brand-ice px-1.5 py-0.5 text-xs">{d.drill_type}</code>
                    <ResultBadge result={d.result} />
                    <span className="ml-auto text-xs text-gray-400">
                      {new Date(d.created_at).toLocaleString("en-CA", { timeZone: "America/Vancouver" })}
                    </span>
                  </div>
                  <p className="mt-1 text-brand-ink">{d.tested_scope}</p>
                  {d.duration_seconds !== null && (
                    <p className="text-xs text-gray-500">Duration: {d.duration_seconds}s</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

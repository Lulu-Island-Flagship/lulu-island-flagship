"use client";

import React, { useEffect, useState } from "react";
import { Loader2, DatabaseBackup, AlertTriangle, CheckCircle2 } from "lucide-react";

interface JobStatus {
  jobType: string;
  due: boolean;
  daysSinceLastRun: number | null;
  lastSuccess: { created_at: string; storage_path: string | null; sha256_hash: string | null; row_count: number | null; destination: string } | null;
  lastAttempt: { created_at: string; status: string; error_message: string | null; destination: string } | null;
}

const LABEL: Record<string, string> = {
  transactions_daily: "Transactions (daily)",
  payroll_per_cycle: "Payroll (per cycle)",
  clients_weekly: "Clients (weekly)",
  photos_monthly: "Photos manifest (monthly)",
  pg_dump_monthly: "pg_dump (monthly reminder)",
};

/**
 * v8.3 E9.10 — Backup status. Ver honestidad de alcance en
 * src/lib/backup-jobs.ts: el destino real hoy es Supabase Storage
 * (fallback dentro del mismo proveedor) hasta que se configuren
 * credenciales de B2/Glacier, y pg_dump es un recordatorio, no un dump
 * automático (requiere acceso directo a Postgres).
 */
export default function BackupsPage() {
  const [jobs, setJobs] = useState<JobStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/backup-status", { credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setJobs(data.jobs || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <DatabaseBackup className="w-6 h-6" />
        <h1 className="text-2xl font-bold">Backup Status</h1>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        Transactions daily, payroll per cycle, clients weekly, photos manifest monthly. CSV+SHA-256
        stored in Supabase Storage (offsite B2/Glacier replication not yet connected — no external
        credentials configured). pg_dump requires direct Postgres access and is a manual monthly
        reminder here, verified separately via DR Drills (E11.4).
      </p>

      {error && <div className="text-red-600 text-sm mb-4">{error}</div>}

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((j) => (
            <div key={j.jobType} className="bg-white rounded border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-1">
                <div className="font-medium">{LABEL[j.jobType] || j.jobType}</div>
                {j.due ? (
                  <span className="inline-flex items-center gap-1 text-amber-700 text-xs">
                    <AlertTriangle className="w-3 h-3" /> Due to run
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-green-700 text-xs">
                    <CheckCircle2 className="w-3 h-3" /> Up to date
                  </span>
                )}
              </div>
              {j.lastSuccess ? (
                <div className="text-xs text-gray-500">
                  Last success: {new Date(j.lastSuccess.created_at).toLocaleString("en-CA")} ·{" "}
                  {j.lastSuccess.row_count ?? "—"} rows · {j.lastSuccess.destination} ·{" "}
                  {j.lastSuccess.sha256_hash ? j.lastSuccess.sha256_hash.slice(0, 12) : "—"}
                </div>
              ) : (
                <div className="text-xs text-gray-400">Never run successfully.</div>
              )}
              {j.lastAttempt && j.lastAttempt.status !== "success" && (
                <div className="text-xs text-red-600 mt-1">
                  Last attempt failed: {j.lastAttempt.error_message}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

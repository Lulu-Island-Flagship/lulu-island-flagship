"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { Loader2, DatabaseBackup, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toIntlLocale } from "@/lib/format";

interface JobStatus {
  jobType: string;
  due: boolean;
  daysSinceLastRun: number | null;
  lastSuccess: { created_at: string; storage_path: string | null; sha256_hash: string | null; row_count: number | null; destination: string } | null;
  lastAttempt: { created_at: string; status: string; error_message: string | null; destination: string } | null;
}

const LABEL_KEYS: Record<string, string> = {
  transactions_daily: "transactionsDaily",
  payroll_per_cycle: "payrollPerCycle",
  clients_weekly: "clientsWeekly",
  photos_monthly: "photosMonthly",
  pg_dump_monthly: "pgDumpMonthly",
};

/**
 * v8.3 E9.10 — Backup status. Ver honestidad de alcance en
 * src/lib/backup-jobs.ts: el destino real hoy es Supabase Storage
 * (fallback dentro del mismo proveedor) hasta que se configuren
 * credenciales de B2/Glacier, y pg_dump es un recordatorio, no un dump
 * automático (requiere acceso directo a Postgres).
 */
export default function BackupsPage() {
  const t = useTranslations("admin.backups");
  const params = useParams();
  // Fix (auditoría 2026-07-30, item 1): las fechas se formateaban con
  // locale fijo "en-CA" sin importar el locale de la ruta (en/fr/zh).
  const locale = toIntlLocale((params?.locale as string) || "en");
  const [jobs, setJobs] = useState<JobStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/backup-status", { credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("errors.loadFailed"));
      setJobs(data.jobs || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.network"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <DatabaseBackup className="w-6 h-6" />
        <h1 className="text-2xl font-bold">{t("title")}</h1>
      </div>
      <p className="text-sm text-gray-500 mb-6">{t("subtitle")}</p>

      {error && <div className="text-red-600 text-sm mb-4">{error}</div>}

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" /> {t("loading")}
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((j) => (
            <div key={j.jobType} className="bg-white rounded border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-1">
                <div className="font-medium">{LABEL_KEYS[j.jobType] ? t(`jobLabels.${LABEL_KEYS[j.jobType]}`) : j.jobType}</div>
                {j.due ? (
                  <span className="inline-flex items-center gap-1 text-amber-700 text-xs">
                    <AlertTriangle className="w-3 h-3" /> {t("dueToRun")}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-green-700 text-xs">
                    <CheckCircle2 className="w-3 h-3" /> {t("upToDate")}
                  </span>
                )}
              </div>
              {j.lastSuccess ? (
                <div className="text-xs text-gray-500">
                  {t("lastSuccess", {
                    date: new Date(j.lastSuccess.created_at).toLocaleString(locale),
                    rows: j.lastSuccess.row_count ?? "—",
                    destination: j.lastSuccess.destination,
                    hash: j.lastSuccess.sha256_hash ? j.lastSuccess.sha256_hash.slice(0, 12) : "—",
                  })}
                </div>
              ) : (
                <div className="text-xs text-gray-400">{t("neverRun")}</div>
              )}
              {j.lastAttempt && j.lastAttempt.status !== "success" && (
                <div className="text-xs text-red-600 mt-1">
                  {t("lastAttemptFailed", { error: j.lastAttempt.error_message || "" })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

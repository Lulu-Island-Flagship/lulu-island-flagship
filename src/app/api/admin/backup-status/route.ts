import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { computeBackupDueStatus, type BackupJobType } from "@/lib/backup-jobs";

const JOB_TYPES: BackupJobType[] = [
  "transactions_daily",
  "payroll_per_cycle",
  "clients_weekly",
  "photos_monthly",
  "pg_dump_monthly",
];

/**
 * GET /api/admin/backup-status — v8.3 E9.10. Última corrida exitosa de
 * cada tipo de backup + si ya está vencida según su intervalo.
 * Recurso "compliance".
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("compliance", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  const todayISO = new Date().toISOString();
  const results = [];

  for (const jobType of JOB_TYPES) {
    const { data: lastSuccess } = await auth.supabase
      .from("backup_job_runs")
      .select("created_at, storage_path, sha256_hash, row_count, destination")
      .eq("job_type", jobType)
      .eq("status", "success")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: lastAttempt } = await auth.supabase
      .from("backup_job_runs")
      .select("created_at, status, error_message, destination")
      .eq("job_type", jobType)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const status = computeBackupDueStatus(jobType, lastSuccess?.created_at ?? null, todayISO);

    results.push({
      ...status,
      lastSuccess: lastSuccess || null,
      lastAttempt: lastAttempt || null,
    });
  }

  return NextResponse.json({ jobs: results }, { status: 200 });
}

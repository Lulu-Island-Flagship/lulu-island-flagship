import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDeterministicCsv, computeSha256Hex, type BackupJobType } from "@/lib/backup-jobs";

const BACKUP_BUCKET = "backups";

/**
 * Sube un CSV construido con buildDeterministicCsv a Supabase Storage
 * (bucket privado "backups", migración 167) y deja el registro en
 * backup_job_runs. Ver honestidad de alcance en src/lib/backup-jobs.ts --
 * `destination` queda 'supabase_storage_fallback' hasta que existan
 * credenciales reales de B2/Glacier.
 */
export async function storeBackupCsv(
  supabase: SupabaseClient,
  jobType: BackupJobType,
  headers: string[],
  rows: (string | number | null)[][],
  periodStartISO: string,
  periodEndISO: string
): Promise<{ success: boolean; storagePath?: string; sha256?: string; error?: string }> {
  const csv = buildDeterministicCsv(headers, rows);
  const sha256 = computeSha256Hex(csv);
  const storagePath = `${jobType}/${periodEndISO.slice(0, 10)}_${sha256.slice(0, 12)}.csv`;

  const { error: uploadError } = await supabase.storage
    .from(BACKUP_BUCKET)
    .upload(storagePath, csv, { contentType: "text/csv", upsert: false });

  if (uploadError) {
    await supabase.from("backup_job_runs").insert({
      job_type: jobType,
      period_start: periodStartISO,
      period_end: periodEndISO,
      destination: "supabase_storage_fallback",
      sha256_hash: sha256,
      row_count: rows.length,
      status: "failed",
      error_message: uploadError.message,
    });
    return { success: false, error: uploadError.message };
  }

  await supabase.from("backup_job_runs").insert({
    job_type: jobType,
    period_start: periodStartISO,
    period_end: periodEndISO,
    destination: "supabase_storage_fallback",
    storage_path: storagePath,
    sha256_hash: sha256,
    row_count: rows.length,
    status: "success",
  });

  return { success: true, storagePath, sha256 };
}

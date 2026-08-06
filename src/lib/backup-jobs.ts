import { createHash } from "@/lib/crypto.server";

/**
 * v8.3 E9.10 — "Backups: transacciones diario (CSV+hash a B2/Glacier),
 * nómina por ciclo, clientes semanal, fotos mensual, pg_dump mensual
 * restaurable <48h en otro proveedor."
 *
 * Honestidad de alcance: esta lib construye la parte real y verificable --
 * qué filas van en cada backup, el CSV determinístico, y su hash SHA-256
 * (para poder demostrar más tarde que el archivo no fue alterado). La
 * réplica automática a Backblaze B2 / S3 Glacier NO está conectada (no hay
 * credenciales de esa cuenta en este entorno) -- cada cron de backup guarda
 * el CSV+hash en Supabase Storage como primera línea de defensa
 * (fuera de la base de datos transaccional, pero en el mismo proveedor) y
 * dejará el `destination` del registro como `'supabase_storage_fallback'`
 * hasta que se configuren credenciales de un proveedor externo real --
 * mismo patrón que "scraping ⏸️ deferido" en competitor-tracking.ts: nunca
 * se simula una réplica offsite que no existe.
 *
 * `pg_dump` no puede ejecutarse desde una función serverless de Next.js
 * (requiere acceso directo psql/pg_dump al host de Postgres) -- ese punto
 * del plan se deja como una tarea programada/documentada para el dueño,
 * con un recordatorio mensual en este mismo sistema (ver
 * BackupJobType 'pg_dump_monthly' -- solo genera el RECORDATORIO, nunca
 * un dump falso).
 */

export type BackupJobType =
  | "transactions_daily"
  | "payroll_per_cycle"
  | "clients_weekly"
  | "photos_monthly"
  | "pg_dump_monthly";

/** Intervalo mínimo requerido entre corridas exitosas de cada tipo (días). "payroll_per_cycle" usa 14 como aproximación del ciclo quincenal -- el disparo real depende de si ya hubo un nuevo ciclo cerrado, no solo del calendario. */
export const BACKUP_REQUIRED_INTERVAL_DAYS: Record<BackupJobType, number> = {
  transactions_daily: 1,
  payroll_per_cycle: 14,
  clients_weekly: 7,
  photos_monthly: 30,
  pg_dump_monthly: 30,
};

export interface BackupDueStatus {
  jobType: BackupJobType;
  lastSuccessfulRunAt: string | null;
  daysSinceLastRun: number | null;
  due: boolean;
}

/** ¿Ya toca correr este backup? Igual que nunca se corrió = debe correr ya. */
export function computeBackupDueStatus(
  jobType: BackupJobType,
  lastSuccessfulRunAt: string | null,
  todayISO: string
): BackupDueStatus {
  const intervalDays = BACKUP_REQUIRED_INTERVAL_DAYS[jobType];
  if (!lastSuccessfulRunAt) {
    return { jobType, lastSuccessfulRunAt: null, daysSinceLastRun: null, due: true };
  }
  const daysSinceLastRun =
    (new Date(todayISO).getTime() - new Date(lastSuccessfulRunAt).getTime()) / (1000 * 60 * 60 * 24);
  return {
    jobType,
    lastSuccessfulRunAt,
    daysSinceLastRun,
    due: daysSinceLastRun >= intervalDays,
  };
}

/** CSV determinístico: mismo orden de columnas y filas siempre produce el mismo archivo (necesario para que el hash sea comparable). */
export function buildDeterministicCsv(headers: string[], rows: (string | number | null)[][]): string {
  const escape = (v: string | number | null): string => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [headers.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))];
  return lines.join("\n");
}

export function computeSha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

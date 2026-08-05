/**
 * Capa 9 — Export Scheduler: Programación de exportaciones automáticas.
 *
 * Permite al owner_admin programar exportaciones contables automáticas
 * mensuales que se ejecutan el día 1 de cada mes. El job toma el P&L
 * y Balance Sheet del mes anterior, los exporta en los formatos
 * configurados, y guarda los archivos en Supabase Storage.
 *
 * La ejecución real del cron se maneja vía `pg_cron` en Postgres (extensión
 * `pg_cron` de Supabase). Este módulo provee la capa de configuración
 * (qué exportar, con qué formato, dónde guardarlo) y la función que el
 * job de pg_cron invoca vía `net.http_post` a un endpoint interno.
 *
 * Almacenamiento: los archivos generados se suben al bucket
 * `accounting-exports` en Supabase Storage, organizados por año/mes:
 * `accounting-exports/2026/08/Lulu_Island_PnL_2026-08.csv`
 *
 * Dependencias:
 *   - Supabase client (service role para Storage + cron).
 *   - export-service.ts: para generar el contenido de exportación.
 *   - accounting-adapter.ts: tipos ExportFormat.
 *
 * @module export-scheduler
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExportFormat } from "@/lib/accounting-adapter";
import { getExportFileName, EXPORT_MIME_TYPES } from "@/lib/accounting-adapter";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Configuración de una exportación programada.
 *
 * Se persiste en la tabla `export_schedules` (creada vía migración).
 * Cada fila representa una regla de exportación automática mensual.
 */
export interface ScheduledExport {
  /** UUID de la regla. */
  id: string;
  /** Día del mes en que se ejecuta (1–28). Default: 1. */
  dayOfMonth: number;
  /** Formato(s) de exportación. Puede ser uno o varios. */
  formats: ExportFormat[];
  /** Tipos de reportes a incluir (pnl, balance_sheet, cash_flow). */
  reports: ExportReportType[];
  /** Bucket de Supabase Storage donde se guardan los archivos. */
  storageBucket: string;
  /** Prefijo de ruta dentro del bucket (ej. "exports/mensuales"). */
  storagePathPrefix: string;
  /** Si está activa esta regla. */
  enabled: boolean;
  /** Timestamp de creación. */
  createdAt: string;
  /** Timestamp de última modificación. */
  updatedAt: string;
}

/** Tipos de reportes financieros que pueden programarse para exportación. */
export type ExportReportType = "pnl" | "balance_sheet" | "cash_flow";

/** Todos los tipos de reportes disponibles. */
export const ALL_REPORT_TYPES: readonly ExportReportType[] = [
  "pnl",
  "balance_sheet",
  "cash_flow",
] as const;

/** Payload para crear o actualizar una exportación programada. */
export interface ScheduledExportInput {
  /** Día del mes (1–28). Default: 1. */
  dayOfMonth?: number;
  /** Formatos a exportar. */
  formats?: ExportFormat[];
  /** Reportes a incluir. */
  reports?: ExportReportType[];
  /** Bucket de Storage. Default: "accounting-exports". */
  storageBucket?: string;
  /** Prefijo de ruta. Default: "monthly". */
  storagePathPrefix?: string;
  /** Activar/desactivar la regla. */
  enabled?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Bucket por defecto para exportaciones programadas. */
const DEFAULT_STORAGE_BUCKET = "accounting-exports";

/** Prefijo de ruta por defecto. */
const DEFAULT_STORAGE_PATH_PREFIX = "monthly";

/** Tabla donde se persisten las configuraciones de exportación programada. */
const SCHEDULES_TABLE = "export_schedules";

/** Nombre que se le da al job en pg_cron. */
const CRON_JOB_NAME = "monthly_accounting_export";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Valida que el día del mes esté en el rango permitido (1–28).
 *
 * Se limita a 28 para evitar problemas con meses que tienen menos días
 * (febrero). pg_cron ejecutaría el job el día 1 del mes siguiente si
 * el día no existe en el mes actual, pero es más predecible restringir
 * a 1–28 y documentarlo.
 *
 * @param day Día del mes.
 * @throws {Error} Si el día está fuera de rango.
 */
function validateDayOfMonth(day: number): void {
  if (!Number.isInteger(day) || day < 1 || day > 28) {
    throw new Error(
      `Día del mes inválido: ${day}. Debe ser un entero entre 1 y 28.`
    );
  }
}

// ---------------------------------------------------------------------------
// Core: schedule / unschedule / list
// ---------------------------------------------------------------------------

/**
 * Programa (crea o actualiza) una exportación automática mensual.
 *
 * Si ya existe una regla activa, la actualiza. Si no, crea una nueva.
 * Solo puede existir UNA regla activa a la vez (simplicidad operativa:
 * un solo job mensual que exporta todo lo configurado).
 *
 * También registra o actualiza el job en `pg_cron` para que se ejecute
 * el día configurado de cada mes.
 *
 * @param supabase Cliente Supabase con permisos de escritura (service role).
 * @param input Configuración de la exportación programada.
 * @returns La regla creada o actualizada.
 *
 * @example
 * ```ts
 * const scheduled = await scheduleMonthlyExport(supabase, {
 *   dayOfMonth: 1,
 *   formats: ["csv", "pdf"],
 *   reports: ["pnl", "balance_sheet"],
 * });
 * ```
 */
export async function scheduleMonthlyExport(
  supabase: SupabaseClient,
  input: ScheduledExportInput = {}
): Promise<ScheduledExport> {
  const dayOfMonth = input.dayOfMonth ?? 1;
  validateDayOfMonth(dayOfMonth);

  const formats = input.formats ?? ["csv"];
  const reports = input.reports ?? ["pnl", "balance_sheet"];
  const storageBucket = input.storageBucket ?? DEFAULT_STORAGE_BUCKET;
  const storagePathPrefix = input.storagePathPrefix ?? DEFAULT_STORAGE_PATH_PREFIX;
  const enabled = input.enabled ?? true;

  // Buscar regla existente (solo una activa a la vez)
  const { data: existing } = await supabase
    .from(SCHEDULES_TABLE)
    .select("id")
    .limit(1)
    .maybeSingle();

  let schedule: ScheduledExport;

  if (existing) {
    const { data: updated, error: updateError } = await supabase
      .from(SCHEDULES_TABLE)
      .update({
        day_of_month: dayOfMonth,
        formats,
        reports,
        storage_bucket: storageBucket,
        storage_path_prefix: storagePathPrefix,
        enabled,
        updated_at: new Date().toISOString(),
      })
      .eq("id", (existing as { id: string }).id)
      .select("*")
      .single();

    if (updateError || !updated) {
      throw new Error(
        `Error al actualizar exportación programada: ${updateError?.message ?? "desconocido"}`
      );
    }

    schedule = mapRowToScheduledExport(updated as ScheduleRow);
  } else {
    const { data: created, error: insertError } = await supabase
      .from(SCHEDULES_TABLE)
      .insert({
        day_of_month: dayOfMonth,
        formats,
        reports,
        storage_bucket: storageBucket,
        storage_path_prefix: storagePathPrefix,
        enabled,
      })
      .select("*")
      .single();

    if (insertError || !created) {
      throw new Error(
        `Error al crear exportación programada: ${insertError?.message ?? "desconocido"}`
      );
    }

    schedule = mapRowToScheduledExport(created as ScheduleRow);
  }

  // Registrar/actualizar el cron job en pg_cron
  await upsertCronJob(supabase, schedule);

  return schedule;
}

/**
 * Obtiene todas las exportaciones programadas configuradas.
 *
 * @param supabase Cliente Supabase con permisos de lectura.
 * @returns Arreglo de reglas de exportación programada (típicamente 0 o 1).
 */
export async function getScheduledExports(
  supabase: SupabaseClient
): Promise<ScheduledExport[]> {
  const { data, error } = await supabase
    .from(SCHEDULES_TABLE)
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("export-scheduler: query failed", error);
    return [];
  }

  return (data ?? []).map(mapRowToScheduledExport);
}

/**
 * Desactiva todas las exportaciones programadas y remueve el job de pg_cron.
 *
 * No borra las filas (audit trail), solo las desactiva (soft-delete semántico
 * vía `enabled = false`).
 *
 * @param supabase Cliente Supabase con permisos de escritura.
 */
export async function disableAllScheduledExports(
  supabase: SupabaseClient
): Promise<void> {
  await supabase
    .from(SCHEDULES_TABLE)
    .update({ enabled: false, updated_at: new Date().toISOString() })
    .eq("enabled", true);

  // Remover el job de pg_cron
  await removeCronJob(supabase);
}

// ---------------------------------------------------------------------------
// Cron job management (pg_cron)
// ---------------------------------------------------------------------------

/**
 * Crea o actualiza el job en pg_cron para la exportación mensual.
 *
 * Usa `cron.schedule()` de la extensión pg_cron. El job hace un HTTP POST
 * al endpoint interno `/api/admin/export/accounting` con el mes anterior
 * como período.
 *
 * El schedule usa formato cron estándar: `0 0 {day} * *` (medianoche del
 * día configurado de cada mes).
 *
 * @param supabase Cliente Supabase con permisos para pg_cron.
 * @param schedule Regla de exportación programada.
 */
async function upsertCronJob(
  supabase: SupabaseClient,
  schedule: ScheduledExport
): Promise<void> {
  if (!schedule.enabled) {
    await removeCronJob(supabase);
    return;
  }

  const day = schedule.dayOfMonth;
  const cronSchedule = `0 0 ${day} * *`;

  // pg_cron solo acepta comandos SQL, no HTTP calls directamente.
  // Para HTTP calls, pg_cron puede usar pg_net (extensión pg_net de Supabase)
  // o podemos usar una función SQL wrapper.
  //
  // Enfoque: programamos una llamada a una función SQL que a su vez
  // usa pg_net.http_post para disparar el endpoint de exportación.
  // Si pg_net no está disponible, el job simplemente loguea un aviso.

  const { error } = await supabase.rpc("schedule_monthly_export_job", {
    p_job_name: CRON_JOB_NAME,
    p_cron_schedule: cronSchedule,
    p_enabled: schedule.enabled,
  });

  if (error) {
    console.error(
      "export-scheduler: pg_cron job upsert failed." +
        " Asegúrate de que pg_cron y pg_net estén habilitados en Supabase." +
        " La configuración se guardó en export_schedules pero el job automático" +
        " no se creó. Error:",
      error
    );
    // No lanzamos — la configuración ya está persistida. El job se puede
    // crear manualmente desde el dashboard de Supabase si pg_cron no está.
  }
}

/**
 * Remueve el job de pg_cron si existe.
 *
 * @param supabase Cliente Supabase con permisos para pg_cron.
 */
async function removeCronJob(supabase: SupabaseClient): Promise<void> {
  const { error } = await supabase.rpc("unschedule_export_job", {
    p_job_name: CRON_JOB_NAME,
  });

  if (error) {
    // No es crítico si falla — puede que el job ya no exista o pg_cron
    // no esté disponible.
    console.error("export-scheduler: cron job removal failed", error);
  }
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

/** Fila cruda de la tabla `export_schedules`. */
interface ScheduleRow {
  id: string;
  day_of_month: number;
  formats: string | string[];
  reports: string | string[];
  storage_bucket: string;
  storage_path_prefix: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Mapea una fila de la base de datos a un objeto `ScheduledExport`.
 *
 * PostgreSQL puede devolver arrays JSON como strings o como arrays nativos
 * según el driver; esta función normaliza ambos casos.
 */
function mapRowToScheduledExport(row: ScheduleRow): ScheduledExport {
  const formats = normalizeStringArray(row.formats) as ExportFormat[];
  const reports = normalizeStringArray(row.reports) as ExportReportType[];

  return {
    id: row.id,
    dayOfMonth: row.day_of_month,
    formats,
    reports,
    storageBucket: row.storage_bucket,
    storagePathPrefix: row.storage_path_prefix,
    enabled: row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Normaliza un valor que puede ser string[], string JSON, o ya un array.
 */
function normalizeStringArray(value: string | string[]): string[] {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

/**
 * Sube un archivo de exportación a Supabase Storage.
 *
 * Los archivos se organizan en: `{prefix}/{YYYY}/{MM}/{filename}`
 *
 * @param supabase Cliente Supabase con permisos de escritura en Storage.
 * @param bucket Nombre del bucket.
 * @param pathPrefix Prefijo de ruta (ej. "monthly").
 * @param periodo Período en formato YYYY-MM.
 * @param format Formato del archivo.
 * @param content Contenido del archivo.
 * @returns URL pública del archivo subido, o null si falló.
 */
export async function uploadExportToStorage(
  supabase: SupabaseClient,
  bucket: string,
  pathPrefix: string,
  periodo: string,
  format: ExportFormat,
  content: string
): Promise<string | null> {
  const [year, month] = periodo.split("-");
  const fileName = getExportFileName(periodo, format);
  const storagePath = `${pathPrefix}/${year}/${month}/${fileName}`;

  const mimeType = EXPORT_MIME_TYPES[format];

  const { error } = await supabase.storage
    .from(bucket)
    .upload(storagePath, content, {
      contentType: mimeType,
      upsert: true,
      cacheControl: "31536000", // 1 año — son archivos históricos inmutables
    });

  if (error) {
    console.error("export-scheduler: storage upload failed", error);
    return null;
  }

  const { data: publicUrl } = supabase.storage
    .from(bucket)
    .getPublicUrl(storagePath);

  return publicUrl?.publicUrl ?? null;
}

// ---------------------------------------------------------------------------
// Run now (manual trigger for testing / admin panel)
// ---------------------------------------------------------------------------

/**
 * Ejecuta manualmente una exportación para el mes anterior y la sube a Storage.
 *
 * Útil para el botón "Ejecutar ahora" en el panel de admin, o para probar
 * la exportación programada sin esperar al día 1 del mes.
 *
 * Calcula automáticamente el período del mes anterior al actual.
 *
 * @param supabase Cliente Supabase con permisos de escritura.
 * @param schedule Regla de exportación a ejecutar.
 * @returns Mapa de formato → URL pública del archivo subido.
 *
 * @example
 * ```ts
 * const schedule = (await getScheduledExports(supabase))[0];
 * const urls = await runScheduledExportNow(supabase, schedule);
 * // urls.get("csv") → "https://.../monthly/2026/07/Lulu_Island_PnL_2026-07.csv"
 * ```
 */
export async function runScheduledExportNow(
  supabase: SupabaseClient,
  schedule: ScheduledExport
): Promise<Map<ExportFormat, string | null>> {
  // Calcular el mes anterior
  const now = new Date();
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const periodo = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}`;

  const results = new Map<ExportFormat, string | null>();

  for (const format of schedule.formats) {
    // Import dinámico para evitar dependencia circular con export-service
    const { handleExportRequest } = await import("@/lib/export-service");

    const result = await handleExportRequest(supabase, {
      periodo,
      format,
    });

    if (!result.ok) {
      console.error(
        `export-scheduler: runNow failed for format=${format}, periodo=${periodo}`,
        result.message
      );
      results.set(format, null);
      continue;
    }

    const url = await uploadExportToStorage(
      supabase,
      schedule.storageBucket,
      schedule.storagePathPrefix,
      periodo,
      format,
      result.content
    );

    results.set(format, url);
  }

  return results;
}

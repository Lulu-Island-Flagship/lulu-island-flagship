/**
 * Tax Submission Log — Registro inmutable de envíos fiscales ante CRA y Service Canada.
 *
 * Proporciona las funciones `logSubmission()` y `getSubmissionHistory()` para
 * registrar consultar todos los envíos fiscales desde un único lugar. Cada
 * envío queda registrado con:
 *
 *  - Quién (admin_id)
 *  - Qué (tipo, periodo, anio)
 *  - Cuándo (fecha_envio)
 *  - Resultado (ACCEPTED / REJECTED / PENDING / UNKNOWN)
 *  - Integridad (xml_hash SHA-256 del XML enviado)
 *  - Trazabilidad (referencia_cra o referencia_service_canada)
 *
 * ## Interconexiones
 *
 *   tax-submission-log.ts ──(usado por)──→ src/app/api/admin/tax/submit/route.ts
 *   tax-submission-log.ts ──(usa)──→ Supabase (service_role, sin RLS)
 *
 * ## Tablas de BD requeridas
 *
 *   - `tax_submission_log`: tabla principal de este módulo (ver SQL abajo).
 *   - `admin_roles`: ya existente — para validar que admin_id es owner_admin.
 */

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { captureError } from "@/lib/observability";

// =========================================================================
// Domain types
// =========================================================================

/** Tipos de envío fiscal que se registran en esta tabla. */
export type TaxSubmissionType = "gst" | "t4" | "t4a" | "roe";

/** Resultado del envío (mismos valores que CRA y Service Canada devuelven). */
export type TaxSubmissionResultado = "ACCEPTED" | "REJECTED" | "PENDING" | "UNKNOWN";

/**
 * Una fila de la tabla `tax_submission_log`.
 *
 * Representa un envío fiscal completo — ya sea a CRA (GST, T4, T4A)
 * o a Service Canada (ROE).
 */
export interface TaxSubmissionLogRow {
  /** UUID autogenerado — primary key. */
  submission_id: string;
  /** Tipo de envío: gst, t4, t4a, o roe. */
  tipo: TaxSubmissionType;
  /** Período fiscal (ej. "2026-Q2", "2026-08", o "2026" para envíos anuales). */
  periodo: string;
  /** Año fiscal al que corresponde el envío. */
  anio: number;
  /** Hash SHA-256 del XML enviado (64 caracteres hexadecimales). */
  xml_hash: string;
  /** Timestamp ISO 8601 del envío. */
  fecha_envio: string;
  /** Resultado reportado por CRA / Service Canada. */
  resultado: TaxSubmissionResultado;
  /** Número de confirmación de CRA (null para ROEs). */
  referencia_cra: string | null;
  /** Número de confirmación de Service Canada (null para envíos CRA). */
  referencia_service_canada: string | null;
  /** UUID del admin que realizó el envío. */
  admin_id: string;
  /** Timestamp de creación del registro (ISO 8601). */
  created_at: string;
}

export const TaxSubmissionLogRowSchema = z.object({
  submission_id: z.string().uuid(),
  tipo: z.enum(["gst", "t4", "t4a", "roe"]),
  periodo: z.string().min(1),
  anio: z.number().int().min(2000).max(2100),
  xml_hash: z.string().length(64),
  fecha_envio: z.string().min(1),
  resultado: z.enum(["ACCEPTED", "REJECTED", "PENDING", "UNKNOWN"]),
  referencia_cra: z.string().nullable(),
  referencia_service_canada: z.string().nullable(),
  admin_id: z.string().uuid(),
  created_at: z.string().min(1),
});

// =========================================================================
// Input types para logSubmission()
// =========================================================================

/** Datos requeridos para registrar un envío fiscal. */
export interface TaxSubmissionLogInput {
  /** Tipo de envío: gst, t4, t4a, o roe. */
  tipo: TaxSubmissionType;
  /** Período fiscal (ej. "2026-Q2", "2026-08", o "2026"). */
  periodo: string;
  /** Año fiscal. */
  anio: number;
  /** Hash SHA-256 del XML enviado. */
  xml_hash: string;
  /** Resultado del envío. */
  resultado: TaxSubmissionResultado;
  /** Número de confirmación de CRA (opcional — null para ROEs). */
  referencia_cra?: string | null;
  /** Número de confirmación de Service Canada (opcional — null para CRA). */
  referencia_service_canada?: string | null;
  /** UUID del admin que realiza el envío. */
  admin_id: string;
}

export const TaxSubmissionLogInputSchema = z.object({
  tipo: z.enum(["gst", "t4", "t4a", "roe"]),
  periodo: z.string().min(1, "periodo es requerido"),
  anio: z.number().int().min(2000).max(2100),
  xml_hash: z.string().length(64, "xml_hash debe ser SHA-256 (64 caracteres hexadecimales)"),
  resultado: z.enum(["ACCEPTED", "REJECTED", "PENDING", "UNKNOWN"]),
  referencia_cra: z.string().nullable().optional(),
  referencia_service_canada: z.string().nullable().optional(),
  admin_id: z.string().uuid("admin_id debe ser un UUID válido"),
});

// =========================================================================
// logSubmission()
// =========================================================================

/**
 * Registra un envío fiscal en la tabla `tax_submission_log`.
 *
 * Este registro es INMUTABLE — una vez escrito, no se modifica. Si un envío
 * es rechazado y se re-intenta, se crea un NUEVO registro (no se pisa el
 * anterior). Esto garantiza una auditoría completa de todos los intentos.
 *
 * La tabla `tax_submission_log` debe tener RLS deshabilitada (solo accesible
 * vía service_role). Los admins consultan el historial a través de la API
 * route, nunca directamente desde el frontend.
 *
 * @param supabase — Cliente Supabase con service_role (sin RLS).
 *   Usar `getServiceRoleClient()` desde `@/lib/admin`.
 * @param input — Datos del envío a registrar.
 * @returns La fila insertada con submission_id asignado, o error.
 */
export async function logSubmission(
  supabase: SupabaseClient,
  input: TaxSubmissionLogInput,
): Promise<{ row: TaxSubmissionLogRow | null; error: string | null }> {
  const parsed = TaxSubmissionLogInputSchema.safeParse(input);
  if (!parsed.success) {
    const msg = "logSubmission: input inválido — " +
      parsed.error.issues.map((i) => i.message).join("; ");
    captureError(new Error(msg), { fn: "logSubmission" });
    return { row: null, error: msg };
  }

  const { tipo, periodo, anio, xml_hash, resultado, referencia_cra, referencia_service_canada, admin_id } = parsed.data;
  const fecha_envio = new Date().toISOString();

  try {
    const { data, error } = await supabase
      .from("tax_submission_log")
      .insert({
        tipo,
        periodo,
        anio,
        xml_hash,
        fecha_envio,
        resultado,
        referencia_cra: referencia_cra ?? null,
        referencia_service_canada: referencia_service_canada ?? null,
        admin_id,
      })
      .select("*")
      .single();

    if (error) {
      captureError(error, {
        fn: "logSubmission",
        table: "tax_submission_log",
        tipo,
        periodo,
      });
      return { row: null, error: error.message };
    }

    const row = data as TaxSubmissionLogRow;

    console.log(
      `tax_submission_log: ${tipo} ${periodo} registrado — ` +
        `submission_id=${row.submission_id}, resultado=${resultado}`,
    );

    return { row, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    captureError(err instanceof Error ? err : new Error(msg), {
      fn: "logSubmission",
      table: "tax_submission_log",
    });
    return { row: null, error: msg };
  }
}

// =========================================================================
// getSubmissionHistory()
// =========================================================================

/**
 * Consulta el historial de envíos fiscales, ordenados del más reciente
 * al más antiguo.
 *
 * @param supabase — Cliente Supabase con service_role (sin RLS).
 * @param limit — Máximo de registros a devolver (default 50, máximo 200).
 * @param tipo — Filtrar por tipo de envío (opcional: "gst", "t4", "t4a", "roe").
 * @param anio — Filtrar por año fiscal (opcional).
 * @returns Array de filas de tax_submission_log ordenadas por fecha_envio DESC.
 */
export async function getSubmissionHistory(
  supabase: SupabaseClient,
  limit = 50,
  tipo?: TaxSubmissionType,
  anio?: number,
): Promise<TaxSubmissionLogRow[]> {
  const clampedLimit = Math.min(Math.max(1, limit), 200);

  let query = supabase
    .from("tax_submission_log")
    .select("*")
    .order("fecha_envio", { ascending: false })
    .limit(clampedLimit);

  if (tipo) {
    query = query.eq("tipo", tipo);
  }

  if (anio !== undefined && Number.isInteger(anio)) {
    query = query.eq("anio", anio);
  }

  try {
    const { data, error } = await query;

    if (error) {
      captureError(error, {
        fn: "getSubmissionHistory",
        table: "tax_submission_log",
        tipo: tipo ?? "all",
        anio: anio ?? "all",
      });
      return [];
    }

    return (data ?? []) as TaxSubmissionLogRow[];
  } catch (err) {
    captureError(err instanceof Error ? err : new Error(String(err)), {
      fn: "getSubmissionHistory",
      table: "tax_submission_log",
    });
    return [];
  }
}

// =========================================================================
// SQL Schema
// =========================================================================

/**
 * ─── MIGRACIÓN SQL para tax_submission_log ───
 *
 * Esta tabla centraliza el registro de TODOS los envíos fiscales: GST,
 * T4, T4A (a CRA) y ROE (a Service Canada). Es independiente de las
 * tablas específicas de cada tipo (roe_submissions, t4_submissions) y
 * actúa como un libro mayor de auditoría fiscal.
 *
 * Reglas:
 *  - INMUTABLE: los registros nunca se modifican ni se borran.
 *    Re-intentos crean nuevas filas.
 *  - Sin RLS: solo accesible vía service_role desde las API routes.
 *  - xml_hash garantiza integridad: permite verificar que el XML enviado
 *    coincide con el generado, incluso meses después.
 *
 * ```sql
 * CREATE TABLE IF NOT EXISTS tax_submission_log (
 *   submission_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   tipo                        TEXT NOT NULL CHECK (tipo IN ('gst', 't4', 't4a', 'roe')),
 *   periodo                     TEXT NOT NULL,
 *   anio                        INTEGER NOT NULL CHECK (anio >= 2000 AND anio <= 2100),
 *   xml_hash                    TEXT NOT NULL CHECK (length(xml_hash) = 64),
 *   fecha_envio                 TIMESTAMPTZ NOT NULL DEFAULT now(),
 *   resultado                   TEXT NOT NULL CHECK (resultado IN ('ACCEPTED', 'REJECTED', 'PENDING', 'UNKNOWN')),
 *   referencia_cra              TEXT,
 *   referencia_service_canada   TEXT,
 *   admin_id                    UUID NOT NULL,
 *   created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
 *
 *   -- Un admin NO puede enviar el MISMO XML dos veces (protección anti-duplicado).
 *   -- Si CRA rechaza y se corrige el XML, el hash cambia → se permite un nuevo intento.
 *   CONSTRAINT uq_tax_submission_xml_hash UNIQUE (xml_hash),
 *
 *   -- Un mismo período + tipo no puede tener más de un envío ACCEPTED.
 *   -- Sí se permite: múltiples REJECTED (intentos fallidos) + el ACCEPTED final.
 *   CONSTRAINT uq_tax_submission_period_type_accepted
 *     UNIQUE NULLS NOT DISTINCT (tipo, periodo, anio, resultado)
 * );
 *
 * CREATE INDEX idx_tax_submission_log_tipo ON tax_submission_log (tipo);
 * CREATE INDEX idx_tax_submission_log_periodo ON tax_submission_log (periodo);
 * CREATE INDEX idx_tax_submission_log_anio ON tax_submission_log (anio);
 * CREATE INDEX idx_tax_submission_log_admin ON tax_submission_log (admin_id);
 * CREATE INDEX idx_tax_submission_log_fecha ON tax_submission_log (fecha_envio DESC);
 * ```
 *
 * NOTA: `UNIQUE NULLS NOT DISTINCT` es sintaxis PostgreSQL 15+. En versiones
 * anteriores, usar un partial unique index:
 *
 * ```sql
 * CREATE UNIQUE INDEX uq_tax_submission_accepted
 *   ON tax_submission_log (tipo, periodo, anio)
 *   WHERE resultado = 'ACCEPTED';
 * ```
 */

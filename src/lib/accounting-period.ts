/**
 * v8.3 — Capa 3 del Financial Core: Accounting Period Engine.
 *
 * Define el ciclo de vida completo de un período contable (YYYY-MM) desde
 * ABIERTO hasta ARCHIVADO, con reglas de transición estrictas y validación
 * Zod en cada frontera.
 *
 * Tabla `periodo_contable`:
 *   - periodo (YYYY-MM) — clave natural, único
 *   - estado: ABIERTO | BLOQUEADO | CERRADO | ARCHIVADO
 *   - fecha_cierre — ISO8601, se puebla al transicionar a CERRADO
 *   - admin_id — UUID del admin que ejecutó el cierre
 *   - tb_hash — snapshot SHA-256 del Trial Balance al momento del cierre
 *   - notas_cierre — texto libre del admin
 *
 * Reglas de estado (inmutables — no hay atajos ni saltos):
 *   ABIERTO:    asientos normales. Único estado que acepta INSERTs directos.
 *   BLOQUEADO:  ningún asiento nuevo sin override de admin (motivo obligatorio
 *               registrado en audit_log).
 *   CERRADO:    inmutable. Corrección = asiento de reversión + asiento correcto,
 *               ambos en el mes ACTUAL (no se toca el mes cerrado). Genera evento
 *               `event.contable.reversion`.
 *   ARCHIVADO:  solo lectura, retención 7 años.
 *
 * Funciones puras: no tocan base de datos. El caller hace INSERT/UPDATE.
 */

import { z } from "zod";
import { uuidv4Schema, isoTimestampSchema } from "@/lib/events";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Períodos contables permitidos: YYYY-MM estricto. */
export const PERIODO_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Años de retención obligatoria para períodos ARCHIVADOS. */
export const ARCHIVO_RETENTION_YEARS = 7;

// ---------------------------------------------------------------------------
// Estado del período contable
// ---------------------------------------------------------------------------

export const PERIODO_ESTADOS = ["ABIERTO", "BLOQUEADO", "CERRADO", "ARCHIVADO"] as const;

export type PeriodoContableEstado = (typeof PERIODO_ESTADOS)[number];

export const periodoEstadoSchema = z.enum(PERIODO_ESTADOS);

// ---------------------------------------------------------------------------
// Transiciones válidas (state machine)
// ---------------------------------------------------------------------------

/**
 * Mapa de transiciones válidas entre estados.
 * Cada estado origen mapea a los estados destino permitidos.
 * No hay atajos: toda transición debe pasar por los estados intermedios.
 * Ej: ABIERTO → CERRADO no es válido; debe ser ABIERTO → BLOQUEADO → CERRADO.
 */
export const VALID_TRANSITIONS: Readonly<Record<PeriodoContableEstado, readonly PeriodoContableEstado[]>> = {
  ABIERTO: ["BLOQUEADO"],
  BLOQUEADO: ["ABIERTO", "CERRADO"],
  CERRADO: ["ARCHIVADO"],
  ARCHIVADO: [],
} as const;

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

/** Fila de la tabla `periodo_contable`. */
export interface PeriodoContable {
  /** Período en formato YYYY-MM (clave natural). */
  periodo: string;
  /** Estado actual del período. */
  estado: PeriodoContableEstado;
  /** ISO8601 del momento en que se cerró el período. `null` si no está CERRADO/ARCHIVADO. */
  fecha_cierre: string | null;
  /** UUID del admin que ejecutó el cierre. `null` si no está CERRADO/ARCHIVADO. */
  admin_id: string | null;
  /** Snapshot SHA-256 del Trial Balance al cierre. `null` si no está CERRADO/ARCHIVADO. */
  tb_hash: string | null;
  /** Notas de cierre ingresadas por el admin. `null` si no hubo. */
  notas_cierre: string | null;
}

/** Input para crear un nuevo período contable (siempre nace ABIERTO). */
export interface CreatePeriodoContableInput {
  periodo: string;
}

/** Input para una transición de estado. */
export interface TransitionPeriodoInput {
  periodo: string;
  estadoActual: PeriodoContableEstado;
  estadoDestino: PeriodoContableEstado;
  adminId: string;
  motivo?: string;
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const periodoSchema = z
  .string()
  .regex(PERIODO_REGEX, "periodo debe ser YYYY-MM (ej. 2026-08)")
  .describe("Período contable en formato YYYY-MM");

export const periodoSchemaCoerce = z
  .string()
  .regex(PERIODO_REGEX, "periodo debe ser YYYY-MM (ej. 2026-08)")
  .describe("Período contable en formato YYYY-MM");

export const periodoContableSchema = z.object({
  periodo: periodoSchema,
  estado: periodoEstadoSchema,
  fecha_cierre: isoTimestampSchema.nullable(),
  admin_id: uuidv4Schema.nullable(),
  tb_hash: z.string().length(64, "tb_hash debe ser SHA-256 (64 caracteres hex)").nullable(),
  notas_cierre: z.string().min(1).max(2000).nullable(),
});

export const createPeriodoContableSchema = z.object({
  periodo: periodoSchema,
});

export const transitionPeriodoSchema = z.object({
  periodo: periodoSchema,
  estadoActual: periodoEstadoSchema,
  estadoDestino: periodoEstadoSchema,
  adminId: uuidv4Schema,
  motivo: z.string().min(1).max(2000).optional(),
});

// ---------------------------------------------------------------------------
// State machine helpers (pure)
// ---------------------------------------------------------------------------

/**
 * Verifica si una transición entre dos estados es válida según la máquina
 * de estados del período contable.
 *
 * @returns `true` si la transición está permitida.
 */
export function canTransition(from: PeriodoContableEstado, to: PeriodoContableEstado): boolean {
  const allowed = VALID_TRANSITIONS[from];
  return allowed.includes(to);
}

/**
 * Retorna los estados destino válidos desde un estado dado.
 */
export function allowedTransitionsFrom(estado: PeriodoContableEstado): readonly PeriodoContableEstado[] {
  return VALID_TRANSITIONS[estado];
}

/**
 * Verifica si un estado permite asientos contables (INSERT en financial_ledger).
 *
 * Reglas:
 * - ABIERTO: sin restricciones → true
 * - BLOQUEADO: solo con override de admin → false (el override se maneja en la capa de API)
 * - CERRADO / ARCHIVADO: inmutable → false
 */
export function acceptsJournalEntries(estado: PeriodoContableEstado): boolean {
  return estado === "ABIERTO";
}

/**
 * Verifica si un estado es considerado inmutable para escrituras directas.
 * CERRADO y ARCHIVADO son inmutables. BLOQUEADO requiere override pero
 * técnicamente no es inmutable (se puede forzar con motivo).
 */
export function isImmutable(estado: PeriodoContableEstado): boolean {
  return estado === "CERRADO" || estado === "ARCHIVADO";
}

/**
 * Indica si el período está en un estado terminal.
 * Solo ARCHIVADO es terminal (no tiene transiciones de salida).
 */
export function isTerminal(estado: PeriodoContableEstado): boolean {
  return VALID_TRANSITIONS[estado].length === 0;
}

// ---------------------------------------------------------------------------
// Event payload: event.contable.reversion
// ---------------------------------------------------------------------------

/**
 * Payload del evento `event.contable.reversion`.
 * Se emite cuando se genera un asiento de reversión para corregir
 * un período CERRADO sin tocarlo (la corrección se registra en el mes actual).
 */
export const contableReversionPayloadSchema = z.object({
  /** Período cerrado donde está el asiento original (nunca se modifica). */
  periodo_original: periodoSchema.describe("Período cerrado del asiento original"),
  /** ID del asiento original en financial_ledger. */
  asiento_original_id: uuidv4Schema.describe("UUID del asiento original en financial_ledger"),
  /** ID del nuevo asiento de reversión en el mes actual. */
  asiento_reversion_id: uuidv4Schema.describe("UUID del asiento de reversión creado en el mes actual"),
  /** ID del nuevo asiento correcto en el mes actual. */
  asiento_correccion_id: uuidv4Schema.describe("UUID del asiento correcto creado en el mes actual"),
  /** UUID del admin que autorizó la corrección. */
  admin_id: uuidv4Schema.describe("Admin que autorizó la corrección"),
  /** Motivo obligatorio de la corrección. */
  motivo: z.string().min(1, "motivo es obligatorio para una reversión contable").max(2000),
  /** Monto en centavos del asiento original (para trazabilidad). */
  monto_original_cents: z.number().int().describe("Monto en centavos del asiento original"),
});

export type ContableReversionPayload = z.infer<typeof contableReversionPayloadSchema>;

// ---------------------------------------------------------------------------
// Audit log entry (estructura para el caller)
// ---------------------------------------------------------------------------

/** Entrada de auditoría que el caller debe insertar en la tabla de audit_log. */
export interface PeriodAuditLogEntry {
  periodo: string;
  accion: "periodo_bloqueado" | "periodo_cerrado" | "periodo_archivado" | "periodo_reabierto" | "asiento_override_bloqueado";
  admin_id: string;
  motivo: string | null;
  tb_hash: string | null;
  timestamp: string;
}

export const periodAuditLogEntrySchema = z.object({
  periodo: periodoSchema,
  accion: z.enum([
    "periodo_bloqueado",
    "periodo_cerrado",
    "periodo_archivado",
    "periodo_reabierto",
    "asiento_override_bloqueado",
  ]),
  admin_id: uuidv4Schema,
  motivo: z.string().max(2000).nullable(),
  tb_hash: z.string().length(64).nullable(),
  timestamp: isoTimestampSchema,
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Valida y parsea un período contable. Lanza ZodError si no cumple.
 */
export function parsePeriodo(periodo: string): string {
  return periodoSchema.parse(periodo);
}

/**
 * Compara dos períodos. Retorna negativo si a < b, positivo si a > b, 0 si igual.
 * Útil para ordenar u obtener el anterior/siguiente.
 */
export function comparePeriodos(a: string, b: string): number {
  return a.localeCompare(b);
}

/**
 * Calcula el período siguiente a uno dado (YYYY-MM → YYYY-MM).
 * Ej: "2026-01" → "2026-02", "2026-12" → "2027-01".
 */
export function nextPeriodo(periodo: string): string {
  const [year, month] = periodo.split("-").map(Number);
  const d = new Date(Date.UTC(year, month, 1)); // month is 0-indexed in JS Date, so month=12 → next Jan
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * Calcula el período anterior a uno dado (YYYY-MM → YYYY-MM).
 * Ej: "2026-02" → "2026-01", "2026-01" → "2025-12".
 */
export function prevPeriodo(periodo: string): string {
  const [year, month] = periodo.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 2, 1)); // go back one month
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * Calcula el período actual en UTC (YYYY-MM).
 * Función pura: recibe una Date para ser testeable.
 */
export function getCurrentPeriodo(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * Verifica si un período está dentro de la ventana de retención legal.
 * Un período ARCHIVADO debe conservarse 7 años desde su fecha de cierre.
 *
 * @param fechaCierreIso — ISO8601 de cuando se cerró el período
 * @param now — fecha actual para el cálculo (testeable)
 * @returns true si el período aún debe conservarse
 */
export function isWithinRetentionWindow(fechaCierreIso: string, now: Date = new Date()): boolean {
  const cierre = new Date(fechaCierreIso);
  const retentionDeadline = new Date(cierre);
  retentionDeadline.setUTCFullYear(cierre.getUTCFullYear() + ARCHIVO_RETENTION_YEARS);
  return now <= retentionDeadline;
}

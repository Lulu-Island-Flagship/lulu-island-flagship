/**
 * v8.3 — Capa 3 del Financial Core: Close Accounting Period.
 *
 * `closeAccountingPeriod` es la función pura que ejecuta el cierre contable
 * de un período (ABIERTO → BLOQUEADO → CERRADO). No toca la base de datos —
 * recibe los datos, los valida, produce los artefactos de cierre (Trial Balance
 * snapshot SHA-256, reportes P&L / Balance Sheet / Cash Flow, entrada de
 * auditoría) y retorna el resultado estructurado para que el caller persista.
 *
 * Pipeline de cierre (7 pasos, secuenciales, atómicos en decisión):
 *   Paso 1: Recibe Trial Balance pre-consultado
 *   Paso 2: Valida que SUM(debitos) === SUM(creditos)
 *   Paso 3: Si no cuadra, retorna error con detalle de divergencia
 *   Paso 4: Genera P&L, Balance Sheet, Cash Flow (vía reporting engine)
 *   Paso 5: Bloquea el mes (ABIERTO → BLOQUEADO → CERRADO)
 *   Paso 6: Crea snapshot SHA-256 del TB para auditoría futura
 *   Paso 7: Produce entrada de audit_log
 *
 * El caller debe:
 *   1. Leer todas las entradas de financial_ledger del período
 *   2. Armar el TrialBalance y pasarlo a esta función
 *   3. Persistir los reportes generados y la entrada de auditoría
 *   4. Ejecutar UPDATE en periodo_contable con los nuevos valores
 */

import { z } from "zod";
import { uuidv4Schema, isoTimestampSchema } from "@/lib/events";
import {
  periodoSchema,
  periodoContableSchema,
  type PeriodoContable,
  type PeriodAuditLogEntry,
  canTransition,
} from "@/lib/accounting-period";

// ---------------------------------------------------------------------------
// Trial Balance types
// ---------------------------------------------------------------------------

/** Una línea del Trial Balance. */
export interface TrialBalanceLine {
  /** Código de cuenta contable (plan de cuentas). */
  account_code: string;
  /** Nombre legible de la cuenta. */
  account_name: string;
  /** Total de débitos del período en centavos. */
  debitos_cents: number;
  /** Total de créditos del período en centavos. */
  creditos_cents: number;
}

/** Trial Balance completo de un período. */
export interface TrialBalance {
  periodo: string;
  lines: TrialBalanceLine[];
  /** ISO8601 del momento en que se generó el TB. */
  generated_at: string;
}

export const trialBalanceLineSchema = z.object({
  account_code: z.string().min(1, "account_code no puede estar vacío"),
  account_name: z.string().min(1, "account_name no puede estar vacío"),
  debitos_cents: z.number().int("debitos_cents debe ser entero (centavos)"),
  creditos_cents: z.number().int("creditos_cents debe ser entero (centavos)"),
});

export const trialBalanceSchema = z.object({
  periodo: periodoSchema,
  lines: z.array(trialBalanceLineSchema).min(1, "Trial Balance debe tener al menos una línea"),
  generated_at: isoTimestampSchema,
});

// ---------------------------------------------------------------------------
// Report types (PnL, Balance Sheet, Cash Flow)
// ---------------------------------------------------------------------------

export interface PnLReport {
  periodo: string;
  ingresos_cents: number;
  costo_ventas_cents: number;
  utilidad_bruta_cents: number;
  gastos_operativos_cents: number;
  utilidad_operativa_cents: number;
  otros_ingresos_cents: number;
  otros_gastos_cents: number;
  utilidad_neta_cents: number;
  generated_at: string;
}

export interface BalanceSheetReport {
  periodo: string;
  activos_corrientes_cents: number;
  activos_no_corrientes_cents: number;
  total_activos_cents: number;
  pasivos_corrientes_cents: number;
  pasivos_no_corrientes_cents: number;
  total_pasivos_cents: number;
  patrimonio_cents: number;
  total_pasivo_patrimonio_cents: number;
  generated_at: string;
}

export interface CashFlowReport {
  periodo: string;
  flujo_operativo_cents: number;
  flujo_inversion_cents: number;
  flujo_financiamiento_cents: number;
  flujo_neto_cents: number;
  saldo_inicial_cents: number;
  saldo_final_cents: number;
  generated_at: string;
}

// ---------------------------------------------------------------------------
// Reporting engine contract
// ---------------------------------------------------------------------------

/**
 * Interfaz del reporting engine.
 * El caller debe proveer implementaciones concretas que lean de la base de datos
 * y produzcan los reportes. Esto permite que `closeAccountingPeriod` sea pura
 * y testeable sin dependencia de DB.
 */
export interface ReportingEngine {
  generatePnL(tb: TrialBalance): Promise<PnLReport>;
  generateBalanceSheet(tb: TrialBalance): Promise<BalanceSheetReport>;
  generateCashFlow(tb: TrialBalance): Promise<CashFlowReport>;
}

// ---------------------------------------------------------------------------
// Close result types
// ---------------------------------------------------------------------------

/** Resultado exitoso del cierre contable. */
export interface ClosePeriodSuccess {
  success: true;
  periodo: string;
  /** Período contable actualizado (estado = CERRADO). */
  periodoActualizado: PeriodoContable;
  /** Snapshot SHA-256 del Trial Balance en hex (64 caracteres). */
  tbHash: string;
  /** Reportes financieros generados. */
  reports: {
    pnl: PnLReport;
    balanceSheet: BalanceSheetReport;
    cashFlow: CashFlowReport;
  };
  /** Entrada de auditoría para persistir. */
  auditEntry: PeriodAuditLogEntry;
  /** Suma total de débitos (centavos). */
  totalDebitosCents: number;
  /** Suma total de créditos (centavos). */
  totalCreditosCents: number;
}

/** Error de cierre: el Trial Balance no cuadra. */
export interface ClosePeriodDivergenceError {
  success: false;
  code: "TB_DIVERGENCE";
  periodo: string;
  totalDebitosCents: number;
  totalCreditosCents: number;
  /** Diferencia en centavos (debitos - creditos). */
  divergenciaCents: number;
  message: string;
  /** Detalle cuenta por cuenta de dónde está la divergencia. */
  detail: {
    account_code: string;
    account_name: string;
    debitos_cents: number;
    creditos_cents: number;
    neto_cents: number;
  }[];
}

/** Error de cierre: transición de estado inválida. */
export interface ClosePeriodInvalidStateError {
  success: false;
  code: "INVALID_STATE_TRANSITION";
  periodo: string;
  estadoActual: string;
  estadoEsperado: string;
  message: string;
}

export type ClosePeriodResult =
  | ClosePeriodSuccess
  | ClosePeriodDivergenceError
  | ClosePeriodInvalidStateError;

// ---------------------------------------------------------------------------
// Zod schemas for results (validation)
// ---------------------------------------------------------------------------

export const closePeriodSuccessSchema = z.object({
  success: z.literal(true),
  periodo: periodoSchema,
  periodoActualizado: periodoContableSchema,
  tbHash: z.string().length(64),
  reports: z.object({
    pnl: z.object({
      periodo: periodoSchema,
      ingresos_cents: z.number().int(),
      costo_ventas_cents: z.number().int(),
      utilidad_bruta_cents: z.number().int(),
      gastos_operativos_cents: z.number().int(),
      utilidad_operativa_cents: z.number().int(),
      otros_ingresos_cents: z.number().int(),
      otros_gastos_cents: z.number().int(),
      utilidad_neta_cents: z.number().int(),
      generated_at: isoTimestampSchema,
    }),
    balanceSheet: z.object({
      periodo: periodoSchema,
      activos_corrientes_cents: z.number().int(),
      activos_no_corrientes_cents: z.number().int(),
      total_activos_cents: z.number().int(),
      pasivos_corrientes_cents: z.number().int(),
      pasivos_no_corrientes_cents: z.number().int(),
      total_pasivos_cents: z.number().int(),
      patrimonio_cents: z.number().int(),
      total_pasivo_patrimonio_cents: z.number().int(),
      generated_at: isoTimestampSchema,
    }),
    cashFlow: z.object({
      periodo: periodoSchema,
      flujo_operativo_cents: z.number().int(),
      flujo_inversion_cents: z.number().int(),
      flujo_financiamiento_cents: z.number().int(),
      flujo_neto_cents: z.number().int(),
      saldo_inicial_cents: z.number().int(),
      saldo_final_cents: z.number().int(),
      generated_at: isoTimestampSchema,
    }),
  }),
  auditEntry: z.object({
    periodo: periodoSchema,
    accion: z.enum(["periodo_cerrado"]),
    admin_id: uuidv4Schema,
    motivo: z.string().nullable(),
    tb_hash: z.string().length(64),
    timestamp: isoTimestampSchema,
  }),
  totalDebitosCents: z.number().int(),
  totalCreditosCents: z.number().int(),
});

// ---------------------------------------------------------------------------
// SHA-256 helper
// ---------------------------------------------------------------------------

/**
 * Genera un hash SHA-256 del Trial Balance en formato hexadecimal (64 chars).
 *
 * La serialización es determinística: cada línea se ordena por account_code
 * y se serializa como `account_code:debitos:creditos` separado por newlines.
 * Esto garantiza que el mismo TB siempre produzca el mismo hash.
 *
 * Usa Web Crypto API (disponible en Node 20+, Edge, y browsers).
 */
async function hashTrialBalance(tb: TrialBalance): Promise<string> {
  // Orden determinístico por account_code
  const sorted = [...tb.lines].sort((a, b) => a.account_code.localeCompare(b.account_code));

  const payload = sorted
    .map((l) => `${l.account_code}:${l.debitos_cents}:${l.creditos_cents}`)
    .join("\n");

  const encoder = new TextEncoder();
  const data = encoder.encode(payload);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Valida que el Trial Balance cuadre: SUM(debitos) === SUM(creditos).
 *
 * @returns objeto con totales y divergencia, o null si cuadra.
 */
function validateTrialBalanceBalance(tb: TrialBalance): {
  totalDebitosCents: number;
  totalCreditosCents: number;
  divergenciaCents: number;
  isBalanced: boolean;
  /** Detalle cuenta por cuenta del neto. */
  detail: { account_code: string; account_name: string; debitos_cents: number; creditos_cents: number; neto_cents: number }[];
} {
  let totalDebitosCents = 0;
  let totalCreditosCents = 0;
  const detail: { account_code: string; account_name: string; debitos_cents: number; creditos_cents: number; neto_cents: number }[] = [];

  for (const line of tb.lines) {
    totalDebitosCents += line.debitos_cents;
    totalCreditosCents += line.creditos_cents;
    detail.push({
      account_code: line.account_code,
      account_name: line.account_name,
      debitos_cents: line.debitos_cents,
      creditos_cents: line.creditos_cents,
      neto_cents: line.debitos_cents - line.creditos_cents,
    });
  }

  const divergenciaCents = totalDebitosCents - totalCreditosCents;

  return {
    totalDebitosCents,
    totalCreditosCents,
    divergenciaCents,
    isBalanced: divergenciaCents === 0,
    detail,
  };
}

// ---------------------------------------------------------------------------
// closeAccountingPeriod
// ---------------------------------------------------------------------------

export interface CloseAccountingPeriodInput {
  /** Período a cerrar (YYYY-MM). */
  periodo: string;
  /** Trial Balance pre-consultado del período. */
  trialBalance: TrialBalance;
  /** UUID del admin que ejecuta el cierre. */
  adminId: string;
  /** Notas de cierre opcionales. */
  notasCierre?: string;
  /** Estado actual del período en la DB. Debe ser ABIERTO. */
  estadoActual: "ABIERTO";
  /**
   * Reporting engine para generar P&L, Balance Sheet, Cash Flow.
   * Si no se provee, el cierre falla — los reportes son obligatorios
   * para cerrar un período.
   */
  reportingEngine: ReportingEngine;
}

/**
 * Ejecuta el pipeline completo de cierre contable de un período.
 *
 * Pipeline (7 pasos):
 *   1. Recibe Trial Balance (viene en el input, ya consultado por el caller)
 *   2. Valida que SUM(debitos) === SUM(creditos)
 *   3. Si no cuadra, retorna ClosePeriodDivergenceError con detalle
 *   4. Genera P&L, Balance Sheet, Cash Flow vía reporting engine
 *   5. Determina transición de estado (ABIERTO → BLOQUEADO → CERRADO)
 *   6. Crea snapshot SHA-256 del TB para auditoría
 *   7. Produce entrada de audit_log
 *
 * Esta función es pura: no toca la base de datos. El caller debe:
 *   - Persistir el UPDATE en periodo_contable (estado, fecha_cierre, tb_hash, etc.)
 *   - Persistir los reportes generados
 *   - Insertar la entrada de auditoría
 *
 * @returns ClosePeriodResult con todos los artefactos de cierre o error detallado.
 */
export async function closeAccountingPeriod(
  input: CloseAccountingPeriodInput
): Promise<ClosePeriodResult> {
  // ── Paso 1: Validación de input ──────────────────────────────────────────
  const periodo = periodoSchema.parse(input.periodo);

  // Verificar que el TB corresponde al período
  if (input.trialBalance.periodo !== periodo) {
    return {
      success: false,
      code: "INVALID_STATE_TRANSITION",
      periodo,
      estadoActual: input.estadoActual,
      estadoEsperado: "ABIERTO",
      message: `Trial Balance periodo mismatch: esperado ${periodo}, recibido ${input.trialBalance.periodo}`,
    };
  }

  // Verificar que el estado actual permite el cierre
  if (input.estadoActual !== "ABIERTO") {
    return {
      success: false,
      code: "INVALID_STATE_TRANSITION",
      periodo,
      estadoActual: input.estadoActual,
      estadoEsperado: "ABIERTO",
      message: `No se puede cerrar un período en estado ${input.estadoActual}. Debe estar ABIERTO.`,
    };
  }

  if (!canTransition("ABIERTO", "BLOQUEADO")) {
    return {
      success: false,
      code: "INVALID_STATE_TRANSITION",
      periodo,
      estadoActual: "ABIERTO",
      estadoEsperado: "BLOQUEADO",
      message: "Transición ABIERTO → BLOQUEADO no está permitida en la máquina de estados.",
    };
  }

  // ── Pasos 2-3: Validar que el TB cuadre ──────────────────────────────────
  const balance = validateTrialBalanceBalance(input.trialBalance);

  if (!balance.isBalanced) {
    return {
      success: false,
      code: "TB_DIVERGENCE",
      periodo,
      totalDebitosCents: balance.totalDebitosCents,
      totalCreditosCents: balance.totalCreditosCents,
      divergenciaCents: balance.divergenciaCents,
      message: `Trial Balance no cuadra: débitos=${balance.totalDebitosCents}, créditos=${balance.totalCreditosCents}, divergencia=${balance.divergenciaCents} centavos`,
      detail: balance.detail,
    };
  }

  // ── Paso 4: Generar reportes financieros ─────────────────────────────────
  const now = new Date().toISOString();

  let pnl: PnLReport;
  let balanceSheet: BalanceSheetReport;
  let cashFlow: CashFlowReport;

  try {
    [pnl, balanceSheet, cashFlow] = await Promise.all([
      input.reportingEngine.generatePnL(input.trialBalance),
      input.reportingEngine.generateBalanceSheet(input.trialBalance),
      input.reportingEngine.generateCashFlow(input.trialBalance),
    ]);
  } catch (err) {
    // Si el reporting engine falla, propagamos el error como fallo de cierre
    const message = err instanceof Error ? err.message : "Error desconocido en reporting engine";
    return {
      success: false,
      code: "INVALID_STATE_TRANSITION",
      periodo,
      estadoActual: "ABIERTO",
      estadoEsperado: "CERRADO",
      message: `Reporting engine falló: ${message}`,
    };
  }

  // ── Paso 5: Transición de estado ─────────────────────────────────────────
  // ABIERTO → BLOQUEADO ocurre al iniciar el cierre
  // BLOQUEADO → CERRADO ocurre al completar exitosamente
  // Como esta función representa el cierre completo exitoso,
  // el resultado refleja el estado final CERRADO.

  const fechaCierre = now;

  // ── Paso 6: Snapshot SHA-256 del TB ──────────────────────────────────────
  const tbHash = await hashTrialBalance(input.trialBalance);

  // ── Paso 7: Entrada de auditoría ─────────────────────────────────────────
  const auditEntry: PeriodAuditLogEntry = {
    periodo,
    accion: "periodo_cerrado",
    admin_id: input.adminId,
    motivo: input.notasCierre ?? null,
    tb_hash: tbHash,
    timestamp: now,
  };

  // ── Construir el período actualizado ─────────────────────────────────────
  const periodoActualizado: PeriodoContable = {
    periodo,
    estado: "CERRADO",
    fecha_cierre: fechaCierre,
    admin_id: input.adminId,
    tb_hash: tbHash,
    notas_cierre: input.notasCierre ?? null,
  };

  return {
    success: true,
    periodo,
    periodoActualizado,
    tbHash,
    reports: { pnl, balanceSheet, cashFlow },
    auditEntry,
    totalDebitosCents: balance.totalDebitosCents,
    totalCreditosCents: balance.totalCreditosCents,
  };
}

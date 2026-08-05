/**
 * v8.3 C.8 + D.7 — Reconciliación nocturna Shadow Ledger ↔ QBO.
 *
 * Job nocturno que compara el saldo operativo del Shadow Ledger (fuente de
 * verdad cuando QBO no responde) contra el balance reportado por QBO. Una
 * divergencia >1% dispara alerta roja de "Conciliación manual requerida".
 *
 * Diferencia con qbo-sync.ts:
 *   - qbo-sync.ts: conciliación POR ORDEN (umbral 0.1%), decide reintentos
 *     de exportación individuales.
 *   - Este archivo: conciliación GLOBAL de saldos (umbral 1%), compara el
 *     agregado de todo el Shadow Ledger contra el account_balance de QBO.
 *     Es el cierre contable nocturno, no la exportación transaccional.
 *
 * Funciones puras: reciben entradas del Shadow Ledger ya leídas y el saldo
 * QBO ya consultado. Devuelven el veredicto. Nunca tocan la base de datos
 * ni llaman a la API de QBO.
 *
 * Interconexiones:
 *   shadow-ledger.ts ──(replayOrderBalance)──→ ledger-reconciliation.ts
 *   qbo-sync.ts ──(umbral de divergencia)──→ ledger-reconciliation.ts
 */

import { z } from "zod";
import {
  replayOrderBalance,
  type LedgerEntryForReplay,
  type ReplayedOrderBalance,
} from "@/lib/shadow-ledger";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Umbral de divergencia global (%): si el Shadow Ledger y QBO difieren más que esto, se requiere conciliación manual. */
export const LEDGER_DIVERGENCE_THRESHOLD = 0.01; // 1%, spec C.8

/** Tolerancia en centavos por debajo de la cual no se considera divergencia real (ruido de redondeo). */
export const LEDGER_DIVERGENCE_MIN_CENTS = 100; // $1.00

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type ReconciliationVerdict =
  | "ok"
  | "warning_minor_divergence"
  | "alert_manual_reconciliation_required";

export interface LedgerReconciliationInput {
  /** Entradas del Shadow Ledger a considerar en la reconciliación. Típicamente todas las entradas no-anuladas. */
  shadowEntries: LedgerEntryForReplay[];
  /** Saldo reportado por QBO para la cuenta contable, en centavos. */
  qboAccountBalanceCents: number;
  /** Fecha de corte de la conciliación (YYYY-MM-DD). */
  asOfDate: string;
}

export interface LedgerReconciliationResult {
  shadowNetCents: number;
  shadowTotalCollectedCents: number;
  shadowTotalRefundedCents: number;
  qboAccountBalanceCents: number;
  divergenceCents: number;
  divergencePercent: number;
  verdict: ReconciliationVerdict;
  message: string;
}

// ---------------------------------------------------------------------------
// Alert payload (Zod-validated for event_log / unified_alerts)
// ---------------------------------------------------------------------------

export const LedgerDivergenceAlertSchema = z.object({
  event: z.literal("event.ledger.divergencia_contable"),
  shadow_net_cents: z.number().int(),
  qbo_balance_cents: z.number().int(),
  divergence_cents: z.number().int(),
  divergence_percent: z.number().min(0),
  as_of_date: z.string(),
  message: z.string(),
  requires_manual_reconciliation: z.literal(true),
});

export type LedgerDivergenceAlert = z.infer<
  typeof LedgerDivergenceAlertSchema
>;

// ---------------------------------------------------------------------------
// Reconciliation logic
// ---------------------------------------------------------------------------

/**
 * Calcula el saldo neto del Shadow Ledger agregando todas las entradas
 * (colecciones - reembolsos) usando la función canónica de shadow-ledger.ts.
 *
 * @returns El balance reconstruido del Shadow Ledger.
 */
export function computeShadowLedgerSaldo(
  entries: LedgerEntryForReplay[]
): ReplayedOrderBalance {
  return replayOrderBalance(entries);
}

/**
 * Compara el saldo neto del Shadow Ledger contra el balance reportado por
 * QBO y emite un veredicto.
 *
 * Reglas:
 *   - Divergencia ≤ 1% del Shadow Ledger → OK.
 *   - Divergencia > 1% pero < $1.00 (ruido) → OK (tolerancia de redondeo).
 *   - Divergencia > 1% Y ≥ $1.00 → ALERTA ROJA: conciliación manual requerida.
 *
 * @returns Resultado de la reconciliación con veredicto y mensaje.
 */
export function reconcileLedgers(
  input: LedgerReconciliationInput
): LedgerReconciliationResult {
  const shadow = computeShadowLedgerSaldo(input.shadowEntries);

  const divergenceCents = Math.abs(
    shadow.netCents - input.qboAccountBalanceCents
  );

  // Divergencia como fracción del Shadow Ledger (si es 0, comparamos contra QBO)
  const referenceCents =
    shadow.netCents !== 0
      ? Math.abs(shadow.netCents)
      : Math.abs(input.qboAccountBalanceCents);

  const divergencePercent =
    referenceCents > 0 ? divergenceCents / referenceCents : 0;

  let verdict: ReconciliationVerdict;
  let message: string;

  if (divergenceCents < LEDGER_DIVERGENCE_MIN_CENTS) {
    // Diferencia menor a $1 — ruido de redondeo aceptable
    verdict = "ok";
    message = `Conciliación OK. Divergencia: $${(divergenceCents / 100).toFixed(2)} CAD (${(divergencePercent * 100).toFixed(2)}%) — dentro de tolerancia.`;
  } else if (divergencePercent <= LEDGER_DIVERGENCE_THRESHOLD) {
    verdict = "ok";
    message = `Conciliación OK. Divergencia: $${(divergenceCents / 100).toFixed(2)} CAD (${(divergencePercent * 100).toFixed(2)}%) — dentro del umbral del 1%.`;
  } else {
    verdict = "alert_manual_reconciliation_required";
    message = `⚠️ CONCILIACIÓN MANUAL REQUERIDA. Shadow Ledger: $${(shadow.netCents / 100).toFixed(2)} CAD vs QBO: $${(input.qboAccountBalanceCents / 100).toFixed(2)} CAD. Divergencia: $${(divergenceCents / 100).toFixed(2)} CAD (${(divergencePercent * 100).toFixed(2)}%).`;
  }

  return {
    shadowNetCents: shadow.netCents,
    shadowTotalCollectedCents: shadow.totalCollectedCents,
    shadowTotalRefundedCents: shadow.totalRefundedCents,
    qboAccountBalanceCents: input.qboAccountBalanceCents,
    divergenceCents,
    divergencePercent: Math.round(divergencePercent * 10_000) / 10_000,
    verdict,
    message,
  };
}

/**
 * Construye una alerta estructurada para escribir en event_log /
 * unified_alerts cuando la reconciliación falla. Devuelve `null` si el
 * veredicto no requiere alerta (OK).
 */
export function buildLedgerDivergenceAlert(
  result: LedgerReconciliationResult
): LedgerDivergenceAlert | null {
  if (result.verdict !== "alert_manual_reconciliation_required") return null;

  const alert: LedgerDivergenceAlert = {
    event: "event.ledger.divergencia_contable",
    shadow_net_cents: result.shadowNetCents,
    qbo_balance_cents: result.qboAccountBalanceCents,
    divergence_cents: result.divergenceCents,
    divergence_percent: result.divergencePercent,
    as_of_date: new Date().toISOString().slice(0, 10),
    message: result.message,
    requires_manual_reconciliation: true,
  };

  return LedgerDivergenceAlertSchema.parse(alert);
}

/**
 * Función de conveniencia: reconcilia y, si hay alerta, la construye en un
 * solo paso. Es lo que el caller del job nocturno típicamente llamaría.
 */
export function runNightlyReconciliation(
  input: LedgerReconciliationInput
): {
  result: LedgerReconciliationResult;
  alert: LedgerDivergenceAlert | null;
} {
  const result = reconcileLedgers(input);
  const alert = buildLedgerDivergenceAlert(result);
  return { result, alert };
}

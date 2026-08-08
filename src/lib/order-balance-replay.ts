/**
 * Capa 0 — Order Balance Replay.
 *
 * Responsabilidad única: reconstruir el saldo financiero de una orden a
 * partir de las filas del Financial Ledger (partida doble). A diferencia
 * de shadow-ledger.ts, aquí no se depende de `event_type` para saber si
 * un monto es cobro o reembolso — se usa la estructura contable.
 *
 * Reglas:
 *  - Cobro: fila donde `cuenta_debito = EFECTIVO` (1-1000) y el crédito
 *    viene de CUENTAS_POR_COBRAR o INGRESOS_PENALIDADES.
 *  - Reembolso: fila donde `cuenta_credito = EFECTIVO` (1-1000) y el débito
 *    viene de REEMBOLSOS_EMITIDOS.
 *  - Holds (FONDOS_RETENIDOS ↔ DEPOSITOS_CONTINGENTES) se netean a cero
 *    y no afectan el balance de caja.
 */

import { CHART_OF_ACCOUNTS, type CuentaContable } from "./chart-of-accounts";

// =========================================================================
// Domain types
// =========================================================================

/**
 * Fila del ledger necesaria para reconstruir el balance de una orden.
 * Solo se necesitan los campos de cuenta y monto; el caller ya filtró
 * por order_id y estado a nivel de base de datos.
 */
export interface FinancialLedgerEntryForReplay {
  cuenta_debito: CuentaContable | null;
  cuenta_credito: CuentaContable | null;
  monto: number;
}

/**
 * Balance reconstruido de una orden desde el Financial Ledger.
 */
export interface ReplayedOrderBalance {
  /** Total cobrado (débitos a Efectivo desde Cuentas por Cobrar). */
  totalCollectedCents: number;
  /** Total reembolsado (créditos a Efectivo hacia Reembolsos Emitidos). */
  totalRefundedCents: number;
  /** Cobrado - Reembolsado. Representa el efectivo neto que dejó la orden. */
  netCents: number;
}

// =========================================================================
// replayOrderBalance — función principal
// =========================================================================

/**
 * Reconstruye el saldo financiero de una orden a partir de sus filas en el
 * Financial Ledger (partida doble).
 *
 * @param entries — Filas del financial_ledger filtradas por order_id.
 * @returns Balance neto (cobrado - reembolsado) en centavos.
 */
export function replayOrderBalance(
  entries: FinancialLedgerEntryForReplay[]
): ReplayedOrderBalance {
  let totalCollectedCents = 0;
  let totalRefundedCents = 0;

  for (const entry of entries) {
    // COBRO: débito a EFECTIVO (1-1000), crédito desde CUENTAS_POR_COBRAR o INGRESOS_PENALIDADES
    if (
      entry.cuenta_debito === CHART_OF_ACCOUNTS.EFECTIVO &&
      (entry.cuenta_credito === CHART_OF_ACCOUNTS.CUENTAS_POR_COBRAR ||
        entry.cuenta_credito === CHART_OF_ACCOUNTS.INGRESOS_PENALIDADES)
    ) {
      totalCollectedCents += entry.monto;
      continue;
    }

    // REEMBOLSO: crédito a EFECTIVO (1-1000), débito desde REEMBOLSOS_EMITIDOS
    if (
      entry.cuenta_credito === CHART_OF_ACCOUNTS.EFECTIVO &&
      entry.cuenta_debito === CHART_OF_ACCOUNTS.REEMBOLSOS_EMITIDOS
    ) {
      totalRefundedCents += entry.monto;
      continue;
    }

    // Holds: FONDOS_RETENIDOS ↔ DEPOSITOS_CONTINGENTES — se netean, no afectan caja
  }

  return {
    totalCollectedCents,
    totalRefundedCents,
    netCents: totalCollectedCents - totalRefundedCents,
  };
}

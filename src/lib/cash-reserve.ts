/**
 * v8.3 E2.9 — Flujo de caja: reserva de impuestos y tope de exposición
 * diaria. Funciones puras, testeables, sin acceso a base de datos.
 *
 * Parámetros económicos canónicos (invariante B.1):
 *   GST 5% + PST 7% = 12% de reserva sobre la porción gravable de cada cobro.
 *   Propinas y partidas no gravables se separan ANTES de calcular la reserva.
 */

export const GST_RATE = 0.05;
export const PST_RATE = 0.07;
export const TAX_RESERVE_RATE = GST_RATE + PST_RATE; // 0.12

export interface ChargeReserveInput {
  /** Monto total cobrado, en cents. */
  grossAmountCents: number;
  /** Propina incluida en el cobro, en cents. No es gravable a efectos de esta reserva. */
  tipAmountCents?: number;
  /** Partidas no gravables adicionales (si las hay), en cents. */
  nonTaxableAmountCents?: number;
}

export interface ChargeReserveSplit {
  grossAmountCents: number;
  tipAmountCents: number;
  nonTaxableAmountCents: number;
  taxableBaseCents: number;
  taxReserveCents: number;
  operationalAmountCents: number;
  reserveRate: number;
}

/**
 * Dado un monto cobrado, calcula cuánto va a la reserva virtual de
 * impuestos (12%) vs. cuánto queda disponible como operativo.
 *
 * Reglas:
 *  - La propina y las partidas no gravables se restan del bruto ANTES de
 *    aplicar el 12% (no son gravables, no se reservan).
 *  - El resto (taxableBaseCents) es la base sobre la que se calcula el 12%.
 *  - operationalAmountCents = grossAmountCents - taxReserveCents
 *    (la propina y lo no gravable quedan en operativo junto con el resto
 *    de la base gravable, tal como llegan al negocio; solo la porción de
 *    impuestos se aparta).
 */
export function calculateReserveSplit(input: ChargeReserveInput): ChargeReserveSplit {
  const grossAmountCents = Math.max(0, Math.round(input.grossAmountCents));
  const tipAmountCents = Math.max(0, Math.round(input.tipAmountCents ?? 0));
  const nonTaxableAmountCents = Math.max(0, Math.round(input.nonTaxableAmountCents ?? 0));

  const excluded = Math.min(grossAmountCents, tipAmountCents + nonTaxableAmountCents);
  const taxableBaseCents = grossAmountCents - excluded;

  const taxReserveCents = Math.round(taxableBaseCents * TAX_RESERVE_RATE);
  const operationalAmountCents = grossAmountCents - taxReserveCents;

  return {
    grossAmountCents,
    tipAmountCents,
    nonTaxableAmountCents,
    taxableBaseCents,
    taxReserveCents,
    operationalAmountCents,
    reserveRate: TAX_RESERVE_RATE,
  };
}

export interface CashExposureInput {
  /** Suma de Holds autorizados y aún no cobrados, en cents. */
  pendingExposureCents: number;
  /** Tope configurable (cash_exposure_settings.daily_exposure_cap_cents). */
  dailyCapCents: number;
}

export interface CashExposureEvaluation {
  pendingExposureCents: number;
  dailyCapCents: number;
  exposureRatio: number;
  overCap: boolean;
}

/**
 * Evalúa si la exposición de efectivo pendiente (Holds sin cobrar) supera
 * el tope diario configurado. El tope es un monto absoluto (ver nota en
 * migración 074: no hay integración de saldo bancario real todavía, así
 * que no se puede calcular "% de caja" de forma honesta hoy).
 */
export function evaluateDailyCashExposure(input: CashExposureInput): CashExposureEvaluation {
  const pendingExposureCents = Math.max(0, Math.round(input.pendingExposureCents));
  const dailyCapCents = Math.max(1, Math.round(input.dailyCapCents));
  const exposureRatio = pendingExposureCents / dailyCapCents;

  return {
    pendingExposureCents,
    dailyCapCents,
    exposureRatio,
    overCap: pendingExposureCents > dailyCapCents,
  };
}

/**
 * v8.3 E2.9 — Flujo de caja: reserva de impuestos y tope de exposición
 * diaria. Funciones puras, testeables, sin acceso a base de datos.
 *
 * Parámetros económicos canónicos (invariante B.1):
 *   GST 5% + PST 7% = 12% de reserva sobre la porción gravable de cada cobro.
 *   Propinas y partidas no gravables se separan ANTES de calcular la reserva.
 */

// Fuente única (PROTOCOLO §5): las tasas viven en @/lib/pricing/taxes.
// Re-export para no romper la API pública de cash-reserve.
import { roundHalfUp } from "./money";
import { GST_RATE, PST_RATE } from "@/lib/pricing/taxes";
export { GST_RATE, PST_RATE };

export const TAX_RESERVE_RATE = GST_RATE + PST_RATE; // 0.12

// B-P1-3 fix (auditoría 2026-07-21): TAX_RESERVE_RATE (12%) es la tasa
// ADITIVA sobre un precio ANTES de impuestos (precio + 12% = total). Pero
// grossAmountCents que entra a calculateReserveSplit es el TOTAL ya
// cobrado al cliente, que YA INCLUYE ese 12% (quotes.total = subtotal +
// gst + pst, y así se cobra en Stripe). Aplicar 12% directo sobre un monto
// que ya trae el 12% adentro sobre-reserva: para un total T = base ×
// 1.12, el impuesto real es T × (0.12 / 1.12) ≈ 10.714% de T, no 12% de T.
// Ejemplo: T=$100 (base $89.29 + $10.71 de impuesto) reservaba $12.00 en
// vez de los $10.71 reales -- $1.29 de más por cada $100 cobrados.
export const TAX_RESERVE_RATE_ON_INCLUSIVE_TOTAL = TAX_RESERVE_RATE / (1 + TAX_RESERVE_RATE); // ≈ 0.10714 (float, solo display/metadatos)

// Forma EXACTA de la misma tasa como racional entero: 12% / 112% = 3/28.
// La aritmética de reserva usa esta forma (nunca el float).
export const TAX_RESERVE_ON_INCLUSIVE_NUMERATOR = 3n;
export const TAX_RESERVE_ON_INCLUSIVE_DENOMINATOR = 28n;

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

  // taxableBaseCents es tax-inclusive (viene de un total ya cobrado con
  // impuestos adentro), así que se extrae el impuesto con la tasa
  // "de adentro hacia afuera", no la tasa aditiva.
  const taxReserveCents = Number(
    roundHalfUp(
      BigInt(taxableBaseCents) * TAX_RESERVE_ON_INCLUSIVE_NUMERATOR,
      TAX_RESERVE_ON_INCLUSIVE_DENOMINATOR
    )
  );
  const operationalAmountCents = grossAmountCents - taxReserveCents;

  return {
    grossAmountCents,
    tipAmountCents,
    nonTaxableAmountCents,
    taxableBaseCents,
    taxReserveCents,
    operationalAmountCents,
    reserveRate: TAX_RESERVE_RATE_ON_INCLUSIVE_TOTAL,
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

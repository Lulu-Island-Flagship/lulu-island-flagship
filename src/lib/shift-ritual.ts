import { applyPercentRoundHalfUp, dollarsToCentsExact } from "./money";

/**
 * v8.3 E8.13 — Rituales de inicio y fin de jornada.
 * "Inicio (equipo, clima, ranking) y fin de jornada (ganancias visibles:
 * 'Day Rate $90 + comisiones $12.50 = $102.50' + progreso de insignias)."
 *
 * Función pura para el cierre: arma el desglose de ganancias del día a
 * partir del Day Rate del empleado y los upsells aprobados por el cliente
 * hoy. La comisión de upsell (15%, B.1) es configurable en el plan pero no
 * existe todavía una tabla de parámetros económicos que la exponga -- se
 * usa el valor por defecto documentado, igual que otros valores default en
 * el resto del sistema mientras no exista panel de configuración dedicado.
 */

export const DEFAULT_UPSELL_COMMISSION_RATE = 0.15;

export interface ClosingEarningsInput {
  dayRateDollars: number;
  /** Montos (en dólares) de los upsells aprobados por el cliente hoy para este empleado. */
  approvedUpsellAmountsDollars: number[];
  commissionRate?: number;
}

export interface ClosingEarningsResult {
  dayRateDollars: number;
  commissionDollars: number;
  totalDollars: number;
  /** "Day Rate $90 + comisiones $12.50 = $102.50" -- el formato textual exacto del ejemplo del plan. */
  summaryText: string;
}

export function computeClosingEarnings(input: ClosingEarningsInput): ClosingEarningsResult {
  const rate = input.commissionRate ?? DEFAULT_UPSELL_COMMISSION_RATE;
  const upsellTotal = input.approvedUpsellAmountsDollars.reduce((sum, a) => sum + a, 0);
  const commissionCents = applyPercentRoundHalfUp(dollarsToCentsExact(upsellTotal), rate * 100);
  const commissionDollars = Number(commissionCents) / 100;
  const totalDollars = (Number(dollarsToCentsExact(input.dayRateDollars)) + Number(commissionCents)) / 100;

  return {
    dayRateDollars: input.dayRateDollars,
    commissionDollars,
    totalDollars,
    summaryText: `Day Rate $${input.dayRateDollars} + comisiones $${commissionDollars.toFixed(2)} = $${totalDollars.toFixed(2)}`,
  };
}

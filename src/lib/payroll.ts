/**
 * Cálculo de nómina por resultado con protección salarial mínima de BC.
 *
 * Reglas de negocio:
 *  - day_rate es la base diaria del empleado.
 *  - estimated_service_minutes representa la duración estimada del servicio.
 *  - El equivalente horario no puede ser menor a BC_MIN_WAGE_HOURLY ($18.25/hr).
 *  - QC score por encima del umbral otorga bono por punto.
 *  - QC score por debajo del umbral aplica penalización por punto.
 *  - Rework se paga como máximo 30 minutos adicionales.
 *  - El rework excedente requiere aprobación de supervisor (no se incluye automáticamente).
 */

export const BC_MIN_WAGE_HOURLY = 18.25;
export const DEFAULT_SERVICE_MINUTES = 480; // 8 horas

export interface PayrollCalculationInput {
  dayRate: number; // cents CAD
  estimatedServiceMinutes?: number;
  reworkMinutes?: number;
  qcScore?: number; // 0-100
  qcScoreThreshold?: number; // default 70
  qcBonusPerPoint?: number; // cents per point above threshold
  qcPenaltyPerPoint?: number; // cents per point below threshold
  maxReworkMinutes?: number; // default 30
  minWageHourly?: number; // default BC_MIN_WAGE_HOURLY
}

export interface PayrollCalculationResult {
  baseAmount: number;
  qcBonusAmount: number;
  qcPenaltyAmount: number;
  reworkPaidMinutes: number;
  reworkAmount: number;
  hourlyEquivalent: number;
  minimumWageAdjustment: number;
  grossAmount: number;
}

export function calculatePayroll(
  input: PayrollCalculationInput
): PayrollCalculationResult {
  const {
    dayRate,
    estimatedServiceMinutes = DEFAULT_SERVICE_MINUTES,
    reworkMinutes = 0,
    qcScore,
    qcScoreThreshold = 70,
    qcBonusPerPoint = 0,
    qcPenaltyPerPoint = 0,
    maxReworkMinutes = 30,
    minWageHourly = BC_MIN_WAGE_HOURLY,
  } = input;

  // 1. Base = day rate
  const baseAmount = Math.max(0, dayRate);

  // 2. Ajuste por calidad (QC score)
  let qcBonusAmount = 0;
  let qcPenaltyAmount = 0;

  if (qcScore !== undefined && qcScore !== null) {
    const clampedScore = Math.max(0, Math.min(100, qcScore));
    if (clampedScore > qcScoreThreshold && qcBonusPerPoint > 0) {
      qcBonusAmount = (clampedScore - qcScoreThreshold) * qcBonusPerPoint;
    } else if (clampedScore < qcScoreThreshold && qcPenaltyPerPoint > 0) {
      qcPenaltyAmount = (qcScoreThreshold - clampedScore) * qcPenaltyPerPoint;
    }
  }

  // 3. Rework pagado con tope
  const reworkPaidMinutes = Math.max(0, Math.min(reworkMinutes, maxReworkMinutes));
  const hourlyRateFromDayRate = estimatedServiceMinutes > 0
    ? (baseAmount / estimatedServiceMinutes) * 60
    : 0;
  const effectiveHourlyRate = Math.max(hourlyRateFromDayRate, minWageHourly * 100);
  const reworkAmount = Math.round((reworkPaidMinutes / 60) * effectiveHourlyRate);

  // 4. Equivalente horario inicial
  const subtotalBeforeMinWage = baseAmount + qcBonusAmount - qcPenaltyAmount + reworkAmount;
  const hourlyEquivalent = estimatedServiceMinutes > 0
    ? subtotalBeforeMinWage / (estimatedServiceMinutes / 60)
    : 0;

  // 5. Protección salarial mínima
  const minRequiredAmount = Math.round((estimatedServiceMinutes / 60) * minWageHourly * 100);
  const minimumWageAdjustment = Math.max(0, minRequiredAmount - subtotalBeforeMinWage);

  // 6. Monto bruto final
  const grossAmount = subtotalBeforeMinWage + minimumWageAdjustment;

  return {
    baseAmount,
    qcBonusAmount,
    qcPenaltyAmount,
    reworkPaidMinutes,
    reworkAmount,
    hourlyEquivalent: Number((hourlyEquivalent / 100).toFixed(2)),
    minimumWageAdjustment,
    grossAmount,
  };
}

/**
 * Convierte un monto en dólares a centavos.
 */
export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/**
 * Convierte un monto en centavos a dólares.
 */
export function centsToDollars(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

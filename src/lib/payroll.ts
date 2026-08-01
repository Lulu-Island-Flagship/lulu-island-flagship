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

// ------------------------------------------------------------
// Horas extra (BC ESA / v8.3 B.2.15): >8h estándar = recargo 1.5x sobre
// el EXCEDENTE; >10h queda bloqueado en el despacho (workday.ts), así que
// el excedente pagable nunca supera 2h (120 min). Este cálculo es POR
// DÍA (suma de todos los bloques/órdenes de un empleado ese día), no por
// orden individual -- workday.evaluateWorkday ya decide a nivel de
// despacho si una jornada necesita aprobación; esta función solo calcula
// cuánto dinero corresponde una vez que esa jornada ya ocurrió.
//
// LIMITACIÓN DOCUMENTADA: hoy ninguna ruta del código inserta filas en
// payroll_entries (se leen en varios reportes pero no existe el paso que
// las genera) -- este cálculo queda listo para ese momento, pero no se
// aplica solo todavía. Ver nota en el cron/ruta que eventualmente genere
// la nómina real.
// ------------------------------------------------------------

export interface OvertimePayInput {
  totalDayMinutes: number;
  dayRateCents: number;
  standardDayMinutes?: number; // default 480 (8h)
  overtimeMultiplier?: number; // default 1.5
}

export interface OvertimePayResult {
  overtimeMinutes: number;
  hourlyRateCents: number;
  overtimePayCents: number;
}

export function calculateOvertimePay(input: OvertimePayInput): OvertimePayResult {
  const {
    totalDayMinutes,
    dayRateCents,
    standardDayMinutes = 480,
    overtimeMultiplier = 1.5,
  } = input;

  const overtimeMinutes = Math.max(0, totalDayMinutes - standardDayMinutes);

  // Fix (auditoría externa, hallazgo confirmado): antes se calculaba
  // hourlyRateCents = dayRateCents / (standardDayMinutes/60) (una división
  // en punto flotante) y ESE resultado ya imprecisó se volvía a multiplicar
  // por overtimeMinutes/60 y overtimeMultiplier para llegar a
  // overtimePayCents -- dos operaciones en punto flotante encadenadas antes
  // de redondear, en vez de una. Se reordena para que overtimePayCents salga
  // de una sola expresión combinada (multiplicar primero en enteros,
  // dividir una sola vez) con un único Math.round al final; hourlyRateCents
  // (el valor que se expone para mostrar/depurar) se calcula por separado y
  // ya no alimenta el cálculo de dinero real.
  const overtimePayCents =
    standardDayMinutes > 0
      ? Math.round((overtimeMinutes * dayRateCents * overtimeMultiplier) / standardDayMinutes)
      : 0;
  const hourlyRateCents = standardDayMinutes > 0 ? Math.round((dayRateCents * 60) / standardDayMinutes) : 0;

  return { overtimeMinutes, hourlyRateCents, overtimePayCents };
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

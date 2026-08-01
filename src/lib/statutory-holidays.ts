/**
 * v8.3 — Días festivos pagados de BC (Statutory Holidays, BC ESA Parte 5
 * s.42-45). 11 festivos oficiales, incluyendo Good Friday (fecha móvil,
 * calculada con el algoritmo de Gauss/Anonymous Gregorian) y el National
 * Day for Truth and Reconciliation (agregado a la lista de BC en 2023).
 *
 * Elegibilidad ESA: empleado ≥30 días calendario Y trabajó/ganó salario
 * en 15 de los 30 días calendario anteriores al festivo.
 *
 * Pago: "average day's pay" = salario total ganado en los 30 días
 * calendario anteriores (sin horas extra) ÷ días trabajados en esos 30
 * días.
 */

function toUtcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** N-ésimo día de la semana (0=domingo) de un mes, ej. "3er lunes de febrero". */
function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date {
  const first = toUtcDate(year, month, 1);
  const firstWeekday = first.getUTCDay();
  const offset = (weekday - firstWeekday + 7) % 7;
  const day = 1 + offset + (n - 1) * 7;
  return toUtcDate(year, month, day);
}

/** Último día de la semana (0=domingo) de un mes, ej. "último lunes de mayo" (antes del 25). */
function lastWeekdayBeforeOrOn(year: number, month: number, day: number, weekday: number): Date {
  const target = toUtcDate(year, month, day);
  const targetWeekday = target.getUTCDay();
  const diff = (targetWeekday - weekday + 7) % 7;
  target.setUTCDate(target.getUTCDate() - diff);
  return target;
}

/** Domingo de Pascua vía el algoritmo Anonymous Gregorian (Gauss). */
export function computeEasterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return toUtcDate(year, month, day);
}

export interface StatutoryHoliday {
  name: string;
  dateISO: string;
}

/** Los 11 festivos estatutarios de BC para un año dado. */
export function computeBcStatutoryHolidays(year: number): StatutoryHoliday[] {
  const easterSunday = computeEasterSunday(year);
  const goodFriday = new Date(easterSunday);
  goodFriday.setUTCDate(goodFriday.getUTCDate() - 2);

  return [
    { name: "New Year's Day", dateISO: toIsoDate(toUtcDate(year, 1, 1)) },
    { name: "Family Day", dateISO: toIsoDate(nthWeekdayOfMonth(year, 2, 1, 3)) },
    { name: "Good Friday", dateISO: toIsoDate(goodFriday) },
    { name: "Victoria Day", dateISO: toIsoDate(lastWeekdayBeforeOrOn(year, 5, 24, 1)) },
    { name: "Canada Day", dateISO: toIsoDate(toUtcDate(year, 7, 1)) },
    { name: "BC Day", dateISO: toIsoDate(nthWeekdayOfMonth(year, 8, 1, 1)) },
    { name: "Labour Day", dateISO: toIsoDate(nthWeekdayOfMonth(year, 9, 1, 1)) },
    { name: "National Day for Truth and Reconciliation", dateISO: toIsoDate(toUtcDate(year, 9, 30)) },
    { name: "Thanksgiving", dateISO: toIsoDate(nthWeekdayOfMonth(year, 10, 1, 2)) },
    { name: "Remembrance Day", dateISO: toIsoDate(toUtcDate(year, 11, 11)) },
    { name: "Christmas Day", dateISO: toIsoDate(toUtcDate(year, 12, 25)) },
  ];
}

/**
 * v8.3 fix auditoría E9 (fiscal): festivos reconocidos por CRA a nivel
 * federal, usados para calcular "siguiente día hábil" en fechas límite de
 * remesas/declaraciones (CPP/EI, GST/PST, T4) -- ver cra-remittances.ts.
 * Política de CRA: si la fecha límite cae sábado, domingo o festivo
 * reconocido por CRA, se considera a tiempo si se recibe el siguiente día
 * hábil.
 *
 * OJO: esta lista es DISTINTA de computeBcStatutoryHolidays() de arriba.
 * CRA es una agencia FEDERAL y no reconoce festivos exclusivamente
 * provinciales de BC (Family Day, BC Day) para este propósito, pero sí
 * reconoce Easter Monday y Boxing Day, que el ESA de BC no exige pagar.
 * Confirmar con el contador cada enero si el listado publicado por CRA
 * cambia (no es asesoría fiscal, son las reglas generales vigentes al
 * escribir esto).
 */
export function computeCraRecognizedHolidays(year: number): StatutoryHoliday[] {
  const easterSunday = computeEasterSunday(year);
  const goodFriday = new Date(easterSunday);
  goodFriday.setUTCDate(goodFriday.getUTCDate() - 2);
  const easterMonday = new Date(easterSunday);
  easterMonday.setUTCDate(easterMonday.getUTCDate() + 1);

  return [
    { name: "New Year's Day", dateISO: toIsoDate(toUtcDate(year, 1, 1)) },
    { name: "Good Friday", dateISO: toIsoDate(goodFriday) },
    { name: "Easter Monday", dateISO: toIsoDate(easterMonday) },
    { name: "Victoria Day", dateISO: toIsoDate(lastWeekdayBeforeOrOn(year, 5, 24, 1)) },
    { name: "Canada Day", dateISO: toIsoDate(toUtcDate(year, 7, 1)) },
    { name: "Labour Day", dateISO: toIsoDate(nthWeekdayOfMonth(year, 9, 1, 1)) },
    { name: "National Day for Truth and Reconciliation", dateISO: toIsoDate(toUtcDate(year, 9, 30)) },
    { name: "Thanksgiving", dateISO: toIsoDate(nthWeekdayOfMonth(year, 10, 1, 2)) },
    { name: "Remembrance Day", dateISO: toIsoDate(toUtcDate(year, 11, 11)) },
    { name: "Christmas Day", dateISO: toIsoDate(toUtcDate(year, 12, 25)) },
    { name: "Boxing Day", dateISO: toIsoDate(toUtcDate(year, 12, 26)) },
  ];
}

export const STAT_HOLIDAY_MIN_EMPLOYMENT_DAYS = 30;
export const STAT_HOLIDAY_MIN_DAYS_WORKED_IN_WINDOW = 15;
export const STAT_HOLIDAY_LOOKBACK_DAYS = 30;

export interface StatHolidayEligibilityInput {
  daysEmployedAtHoliday: number;
  daysWorkedInPrior30: number;
}

export interface StatHolidayEligibilityResult {
  eligible: boolean;
  reason: string;
}

export function decideStatHolidayEligibility(input: StatHolidayEligibilityInput): StatHolidayEligibilityResult {
  const { daysEmployedAtHoliday, daysWorkedInPrior30 } = input;

  if (daysEmployedAtHoliday < STAT_HOLIDAY_MIN_EMPLOYMENT_DAYS) {
    return {
      eligible: false,
      reason: `Menos de ${STAT_HOLIDAY_MIN_EMPLOYMENT_DAYS} días de empleo.`,
    };
  }
  if (daysWorkedInPrior30 < STAT_HOLIDAY_MIN_DAYS_WORKED_IN_WINDOW) {
    return {
      eligible: false,
      reason: `Solo ${daysWorkedInPrior30} de ${STAT_HOLIDAY_MIN_DAYS_WORKED_IN_WINDOW} días requeridos trabajados en los ${STAT_HOLIDAY_LOOKBACK_DAYS} días anteriores.`,
    };
  }
  return { eligible: true, reason: "Cumple empleo mínimo y días trabajados requeridos." };
}

/** "Average day's pay" = salario total (sin horas extra) / días trabajados, en los 30 días anteriores. */
export function computeAverageDayPay(totalWagesCentsInPrior30: number, daysWorkedInPrior30: number): number {
  if (daysWorkedInPrior30 <= 0) return 0;
  return Math.round(totalWagesCentsInPrior30 / daysWorkedInPrior30);
}

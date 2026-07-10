/**
 * v8.3 E2.8 / D.9 Doc 2 — Ajuste IPC anual de contratos recurrentes al
 * aniversario, con aviso de 30 días. Funciones puras, testeables, sin
 * acceso a base de datos ni a reloj real (todo recibe "hoy" como input).
 *
 * Mismo patrón que el ajuste de salario mínimo BC (src/lib/economic-params.ts,
 * calculateMinimumWageImpact): detección de cambio + cálculo de impacto en
 * dólares, separado de la aplicación. La diferencia es que este evento SÍ
 * se aplica automáticamente (no está en la lista B.3 de los 6 puntos de
 * intervención humana obligatoria) porque ya fue pactado por contrato.
 */

export const CONTRACT_IPC_NOTICE_DAYS = 30;

function parseIsoDate(dateStr: string): { year: number; month: number; day: number } {
  const [year, month, day] = dateStr.split("-").map(Number);
  return { year, month, day };
}

function toUtcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * Fecha de aniversario del contrato para un año dado: mismo mes/día que
 * start_date, pero en `year`. Maneja 29 de febrero cayendo a 28 en años
 * no bisiestos (regla simple y predecible, evita fechas inválidas).
 */
export function getContractAnniversary(startDateIso: string, year: number): Date {
  const { month, day } = parseIsoDate(startDateIso);
  const candidate = toUtcDate(year, month, day);
  // Si el día se desbordó de mes (ej. 29 feb -> 1 mar en año no bisiesto),
  // retrocede al último día válido del mes original.
  if (candidate.getUTCMonth() !== month - 1) {
    return toUtcDate(year, month + 1, 0);
  }
  return candidate;
}

function daysBetween(a: Date, b: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((b.getTime() - a.getTime()) / msPerDay);
}

/**
 * ¿Hoy es el día en que corresponde enviar el aviso de 30 días para el
 * aniversario de `year`? (D.9 Doc 2: "ajuste IPC anual con 30 días de aviso")
 */
export function isIpcNoticeDue(startDateIso: string, todayIso: string, year: number): boolean {
  const t = parseIsoDate(todayIso);
  const today = toUtcDate(t.year, t.month, t.day);
  const anniversary = getContractAnniversary(startDateIso, year);
  return daysBetween(today, anniversary) === CONTRACT_IPC_NOTICE_DAYS;
}

/**
 * ¿Hoy es el aniversario del contrato para `year`? (día del ajuste real)
 * El primer año del contrato (year === año de start_date) nunca aplica:
 * el ajuste es ANUAL, el contrato recién empieza con precio pactado.
 */
export function isIpcAdjustmentDue(startDateIso: string, todayIso: string, year: number): boolean {
  const { year: startYear } = parseIsoDate(startDateIso);
  if (year <= startYear) return false;
  const t = parseIsoDate(todayIso);
  const today = toUtcDate(t.year, t.month, t.day);
  const anniversary = getContractAnniversary(startDateIso, year);
  return daysBetween(today, anniversary) === 0;
}

export interface IpcAdjustmentInput {
  currentBasePrice: number;
  currentTotal: number;
  /** % de variación IPC, positivo o negativo, ej. 3.2 = +3.2% */
  ipcPercentage: number;
}

export interface IpcAdjustmentResult {
  newBasePrice: number;
  newTotal: number;
  deltaBasePriceDollars: number;
  deltaTotalDollars: number;
}

/**
 * Calcula el nuevo precio de un contrato recurrente aplicando el % IPC.
 * Redondeo al centavo más cercano; sin piso legal aquí (eso ya lo cubre
 * economic-params.ts para el Day Rate mínimo, que es un concepto distinto).
 */
export function calculateIpcAdjustedContractPrice(input: IpcAdjustmentInput): IpcAdjustmentResult {
  const factor = 1 + input.ipcPercentage / 100;
  const newBasePrice = Math.round(input.currentBasePrice * factor * 100) / 100;
  const newTotal = Math.round(input.currentTotal * factor * 100) / 100;

  return {
    newBasePrice,
    newTotal,
    deltaBasePriceDollars: Math.round((newBasePrice - input.currentBasePrice) * 100) / 100,
    deltaTotalDollars: Math.round((newTotal - input.currentTotal) * 100) / 100,
  };
}

/**
 * v8.3 E9.4 — "CRA (T4 anual, T4A para partners no-empleados, CPP/EI
 * mensual, GST/PST trimestral NETFILE desde QBO)."
 *
 * Honestidad: este archivo genera el ESQUELETO de fechas límite (qué
 * períodos existen y cuándo vencen), no presenta ni calcula los montos
 * reales a remitir -- esos salen de nómina (CPP/EI) y de QBO (GST/PST),
 * y el NETFILE real ante CRA es un trámite fuera de este sistema. Lo que
 * aquí se construye es el calendario de obligaciones + su estado
 * (pendiente/presentado), para que nada se olvide -- no un motor de
 * cálculo fiscal. Cualquier monto mostrado en la UI viene de sumar datos
 * ya calculados en otras partes del sistema (payroll-export,
 * accounting), nunca inventado aquí.
 *
 * Fechas límite usadas (deben ser confirmadas por el contador antes de
 * depender de ellas para evitar multas -- son las reglas generales
 * publicadas por CRA al momento de escribir esto, no asesoría fiscal):
 * - CPP/EI: remesa mensual, vence el día 15 del mes siguiente (remitente
 *   regular).
 * - GST/PST: NETFILE trimestral, vence un mes después del cierre del
 *   trimestre.
 * - T4: anual, vence el último día de febrero del año siguiente.
 */

export type RemittanceType = "cpp_ei_monthly" | "gst_pst_quarterly" | "t4_annual";
export type RemittanceStatus = "pending" | "filed";

export interface RemittancePeriod {
  type: RemittanceType;
  periodStartISO: string;
  periodEndISO: string;
  dueDateISO: string;
}

function isoDate(y: number, m: number, d: number): string {
  // m es 1-indexado para legibilidad; Date usa 0-indexado.
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
}

function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Los 12 períodos mensuales de CPP/EI para un año calendario, venciendo el 15 del mes siguiente. */
export function generateCppEiMonthlyPeriods(year: number): RemittancePeriod[] {
  const periods: RemittancePeriod[] = [];
  for (let m = 1; m <= 12; m++) {
    const periodEnd = isoDate(year, m, lastDayOfMonth(year, m));
    const dueYear = m === 12 ? year + 1 : year;
    const dueMonth = m === 12 ? 1 : m + 1;
    periods.push({
      type: "cpp_ei_monthly",
      periodStartISO: isoDate(year, m, 1),
      periodEndISO: periodEnd,
      dueDateISO: isoDate(dueYear, dueMonth, 15),
    });
  }
  return periods;
}

/** Los 4 trimestres de GST/PST para un año calendario, venciendo 1 mes después del cierre. */
export function generateGstPstQuarterlyPeriods(year: number): RemittancePeriod[] {
  const quarters: [number, number][] = [
    [1, 3],
    [4, 6],
    [7, 9],
    [10, 12],
  ];
  return quarters.map(([startMonth, endMonth]) => {
    const periodEnd = isoDate(year, endMonth, lastDayOfMonth(year, endMonth));
    const dueMonth = endMonth === 12 ? 1 : endMonth + 1;
    const dueYear = endMonth === 12 ? year + 1 : year;
    return {
      type: "gst_pst_quarterly",
      periodStartISO: isoDate(year, startMonth, 1),
      periodEndISO: periodEnd,
      dueDateISO: isoDate(dueYear, dueMonth, lastDayOfMonth(dueYear, dueMonth)),
    };
  });
}

/** El único período anual de T4, venciendo el último día de febrero del año siguiente. */
export function generateT4AnnualPeriod(year: number): RemittancePeriod {
  const dueYear = year + 1;
  return {
    type: "t4_annual",
    periodStartISO: isoDate(year, 1, 1),
    periodEndISO: isoDate(year, 12, 31),
    dueDateISO: isoDate(dueYear, 2, lastDayOfMonth(dueYear, 2)),
  };
}

export function generateFullYearSchedule(year: number): RemittancePeriod[] {
  return [
    ...generateCppEiMonthlyPeriods(year),
    ...generateGstPstQuarterlyPeriods(year),
    generateT4AnnualPeriod(year),
  ];
}

/** ¿Ya venció una fecha límite y sigue pendiente? Para resaltar en la UI. */
export function isRemittanceOverdue(
  dueDateISO: string,
  status: RemittanceStatus,
  todayISO: string
): boolean {
  if (status === "filed") return false;
  return new Date(todayISO).getTime() > new Date(dueDateISO).getTime();
}

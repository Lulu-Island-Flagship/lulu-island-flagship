/**
 * v8.3 E9 — Panel de contabilidad operativa (D.9): cobrado / pagado / margen
 * de contribución / margen neto real, agrupado por zona, tipo de servicio y
 * equipo. Funciones puras — reciben registros ya armados desde la base de
 * datos (orden + zona/servicio de la cotización + cobro real capturado +
 * costo de nómina + carga patronal), no hacen queries.
 *
 * Definiciones (D.9):
 *  - Cobrado: monto real capturado del cliente (no el subtotal cotizado).
 *  - Pagado: costo de nómina bruto pagado a los empleados por esa orden.
 *  - Margen de contribución: cobrado - pagado (costo directo de mano de obra).
 *  - Margen neto real: cobrado - pagado - carga patronal (CPP/EI/WorkSafeBC
 *    del empleador) - otros costos operativos atribuibles, si se conocen.
 */

export interface OrderFinancialRecord {
  orderId: string;
  zone: string;
  serviceType: string;
  teamLabel: string;
  collectedCents: number;
  laborCostCents: number;
  employerBurdenCents: number;
  /**
   * Bug #3 (auditoría 2026-07-30): true si employerBurdenCents de esta orden
   * es una ESTIMACIÓN de respaldo (no hay snapshot en payroll_cycle_deductions
   * porque el ciclo de nómina del empleado aún no se exportó), no una cifra
   * confirmada.
   */
  employerBurdenIsEstimated?: boolean;
  otherCostsCents?: number;
}

export interface AccountingGroupSummary {
  key: string;
  orders: number;
  collectedCents: number;
  laborCostCents: number;
  employerBurdenCents: number;
  /** true si AL MENOS una orden del grupo usó la estimación de respaldo de carga patronal. */
  employerBurdenIsEstimated: boolean;
  otherCostsCents: number;
  contributionMarginCents: number;
  /** Fracción 0-1. 0 si no hubo cobro (evita división por cero). */
  contributionMarginPercent: number;
  netMarginCents: number;
  netMarginPercent: number;
}

function summarizeGroup(key: string, records: OrderFinancialRecord[]): AccountingGroupSummary {
  const collectedCents = records.reduce((sum, r) => sum + r.collectedCents, 0);
  const laborCostCents = records.reduce((sum, r) => sum + r.laborCostCents, 0);
  const employerBurdenCents = records.reduce((sum, r) => sum + r.employerBurdenCents, 0);
  const employerBurdenIsEstimated = records.some((r) => r.employerBurdenIsEstimated);
  const otherCostsCents = records.reduce((sum, r) => sum + (r.otherCostsCents ?? 0), 0);

  const contributionMarginCents = collectedCents - laborCostCents;
  const netMarginCents = collectedCents - laborCostCents - employerBurdenCents - otherCostsCents;

  return {
    key,
    orders: records.length,
    collectedCents,
    laborCostCents,
    employerBurdenCents,
    employerBurdenIsEstimated,
    otherCostsCents,
    contributionMarginCents,
    contributionMarginPercent: collectedCents > 0 ? contributionMarginCents / collectedCents : 0,
    netMarginCents,
    netMarginPercent: collectedCents > 0 ? netMarginCents / collectedCents : 0,
  };
}

function groupAndSummarize(
  records: OrderFinancialRecord[],
  keyFn: (r: OrderFinancialRecord) => string
): AccountingGroupSummary[] {
  const groups = new Map<string, OrderFinancialRecord[]>();
  for (const r of records) {
    const key = keyFn(r);
    const list = groups.get(key);
    if (list) {
      list.push(r);
    } else {
      groups.set(key, [r]);
    }
  }
  return Array.from(groups.entries())
    .map(([key, group]) => summarizeGroup(key, group))
    .sort((a, b) => b.collectedCents - a.collectedCents);
}

export function summarizeByZone(records: OrderFinancialRecord[]): AccountingGroupSummary[] {
  return groupAndSummarize(records, (r) => r.zone);
}

export function summarizeByServiceType(records: OrderFinancialRecord[]): AccountingGroupSummary[] {
  return groupAndSummarize(records, (r) => r.serviceType);
}

export function summarizeByTeam(records: OrderFinancialRecord[]): AccountingGroupSummary[] {
  return groupAndSummarize(records, (r) => r.teamLabel);
}

export function summarizeOverall(records: OrderFinancialRecord[]): AccountingGroupSummary {
  return summarizeGroup("total", records);
}

/**
 * v8.3 E9.1 — Prorratea los costos fijos mensuales (fixed_costs_settings)
 * entre las órdenes de un rango arbitrario. Se calcula sobre los meses
 * calendario REALMENTE presentes en `serviceDates` (nunca se asume "1 mes"
 * si el rango cubre varios, ni se promedia con datos inventados) y se
 * reparte en partes iguales entre todas las órdenes del rango.
 *
 * Fix (auditoría 2026-07-30): antes devolvía un único monto escalar
 * (Math.round(total/n)) que el caller aplicaba igual a CADA orden --
 * total*n normalmente no coincide con totalFixedCostsCents por el
 * redondeo (ej. $100.00 entre 3 órdenes = $33.33/orden -> suma $99.99,
 * perdiendo 1 centavo; con más órdenes/meses el faltante crece). Ahora
 * devuelve un array (mismo orden que `serviceDates`) calculado con el
 * método del "residuo más grande": todas las órdenes reciben el piso
 * entero de centavos, y el resto (0 <= resto < serviceDates.length) se
 * reparte de a 1 centavo entre las primeras órdenes del array, así la
 * suma exacta del array siempre es igual a totalFixedCostsCents.
 *
 * @param monthlyFixedCostsCents costo fijo vigente (fixed_costs_settings)
 * @param serviceDates fecha de servicio (YYYY-MM-DD) de cada orden del rango
 * @returns monto en centavos a atribuir a cada orden, en el mismo orden que `serviceDates`
 */
export function computeProratedFixedCostsPerOrder(
  monthlyFixedCostsCents: number,
  serviceDates: string[]
): number[] {
  const n = serviceDates.length;
  if (n === 0) return [];
  const distinctMonths = new Set(serviceDates.map((d) => d.slice(0, 7)));
  const monthsInRange = Math.max(1, distinctMonths.size);
  const totalFixedCostsCents = monthlyFixedCostsCents * monthsInRange;
  const base = Math.floor(totalFixedCostsCents / n);
  const remainder = totalFixedCostsCents - base * n;
  return serviceDates.map((_, i) => base + (i < remainder ? 1 : 0));
}

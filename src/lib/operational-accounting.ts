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
  otherCostsCents?: number;
}

export interface AccountingGroupSummary {
  key: string;
  orders: number;
  collectedCents: number;
  laborCostCents: number;
  employerBurdenCents: number;
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
  const otherCostsCents = records.reduce((sum, r) => sum + (r.otherCostsCents ?? 0), 0);

  const contributionMarginCents = collectedCents - laborCostCents;
  const netMarginCents = collectedCents - laborCostCents - employerBurdenCents - otherCostsCents;

  return {
    key,
    orders: records.length,
    collectedCents,
    laborCostCents,
    employerBurdenCents,
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
 * @param monthlyFixedCostsCents costo fijo vigente (fixed_costs_settings)
 * @param serviceDates fecha de servicio (YYYY-MM-DD) de cada orden del rango
 */
export function computeProratedFixedCostsPerOrder(
  monthlyFixedCostsCents: number,
  serviceDates: string[]
): number {
  if (serviceDates.length === 0) return 0;
  const distinctMonths = new Set(serviceDates.map((d) => d.slice(0, 7)));
  const monthsInRange = Math.max(1, distinctMonths.size);
  const totalFixedCostsCents = monthlyFixedCostsCents * monthsInRange;
  return Math.round(totalFixedCostsCents / serviceDates.length);
}

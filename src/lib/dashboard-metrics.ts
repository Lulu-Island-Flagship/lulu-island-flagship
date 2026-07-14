/**
 * v8.3 D.13 — Dashboard del dueño ("4+1 números").
 *
 * Funciones puras de cálculo + semáforo. La obtención de datos (Supabase)
 * vive en el route handler; todo lo que decide un número o un color vive
 * aquí, testeable sin base de datos (mismo patrón que scoring.ts,
 * batch-capture-eligibility.ts, etc.).
 *
 * Los 4 umbrales "duros" vienen literales del spec D.13:
 *   Servicios sin disputa      > 95%
 *   Batch Capture exitoso      > 98%
 *   Score promedio equipos     > 75
 *   Margen de contribución     > 25%
 * El "+1" (Margen neto real) es la única de las 5 que el spec pide con
 * "su propio semáforo" sin darle un número — D.3 solo exige que nunca se
 * fusione con el de contribución. MARGIN_FLOOR_PERCENT (15%, D.2) es el
 * piso de margen de CONTRIBUCIÓN a nivel de una sola cotización, no el
 * umbral del neto agregado mensual; reusarlo tal cual para el neto sería
 * incorrecto porque el neto siempre es ≤ el de contribución por
 * construcción. Se usa un umbral explícito, más bajo y documentado como tal,
 * hasta que el dueño calibre uno propio con datos reales de costos fijos.
 */

export type Semaphore = "green" | "yellow" | "red" | "unknown";

export const DASHBOARD_THRESHOLDS = {
  disputeFreeRatePercent: 95,
  batchCaptureSuccessRatePercent: 98,
  teamScoreAverage: 75,
  contributionMarginPercent: 25,
  /** Umbral inicial razonable, NO literal del spec (ver comentario arriba) — recalibrable por el dueño. */
  netMarginPercent: 10,
} as const;

/**
 * Semáforo genérico para métricas "más alto es mejor". La banda amarilla es
 * el 90%-100% del umbral; debajo de 90% del umbral es rojo. `null`/`undefined`
 * (dato no disponible) siempre es "unknown", nunca se disfraza de rojo.
 */
export function semaphoreForMinThreshold(
  value: number | null | undefined,
  threshold: number,
  warningRatio = 0.9
): Semaphore {
  if (value === null || value === undefined || Number.isNaN(value)) return "unknown";
  if (value >= threshold) return "green";
  if (value >= threshold * warningRatio) return "yellow";
  return "red";
}

export interface DisputeFreeRateInput {
  completedServicesCount: number;
  servicesWithDisputeCount: number;
}

/** % de servicios completados en la ventana que NO tuvieron ningún warranty_claim. */
export function computeDisputeFreeRatePercent(input: DisputeFreeRateInput): number | null {
  if (input.completedServicesCount <= 0) return null;
  const disputeFree = input.completedServicesCount - input.servicesWithDisputeCount;
  return round2((disputeFree / input.completedServicesCount) * 100);
}

export interface BatchCaptureRateInput {
  successfulCaptureCount: number;
  failedCaptureCount: number;
}

/** % de intentos de Batch Capture (7PM) que terminaron en balance_captured, no capture_failed. */
export function computeBatchCaptureSuccessRatePercent(input: BatchCaptureRateInput): number | null {
  const total = input.successfulCaptureCount + input.failedCaptureCount;
  if (total <= 0) return null;
  return round2((input.successfulCaptureCount / total) * 100);
}

export interface NetMarginInput {
  /** Promedio de quotes.estimated_margin_contribution (%) de las órdenes completadas de la ventana. */
  avgContributionMarginPercent: number | null;
  /** Promedio de quotes.total (CAD, no cents) de esas mismas órdenes. */
  avgOrderValueDollars: number | null;
  monthlyFixedCostsCents: number;
  /** Servicios completados en el mes de referencia (para prorratear costos fijos). */
  servicesCountThisMonth: number;
  /** true si nunca se configuró un costo fijo real (solo existe el seed en $0) — el neto no debe mostrarse como si fuera confiable. */
  fixedCostsConfigured: boolean;
}

export interface NetMarginResult {
  netMarginPercent: number | null;
  /** Costo fijo prorrateado por servicio, en dólares — se muestra junto al número para que la fórmula sea visible (invariante: nunca un número sin su fórmula). */
  fixedCostPerServiceDollars: number | null;
}

/**
 * Margen_neto_real = Margen_contribucion − (Costos_fijos_mes ÷ servicios_del_mes)
 * (D.3). Se expresa en el mismo % que el de contribución para que ambos
 * números sean directamente comparables en el dashboard, SIEMPRE separados
 * (nunca fusionados — invariante D.3).
 */
export function computeNetMargin(input: NetMarginInput): NetMarginResult {
  if (
    !input.fixedCostsConfigured ||
    input.avgContributionMarginPercent === null ||
    input.avgOrderValueDollars === null ||
    input.avgOrderValueDollars <= 0 ||
    input.servicesCountThisMonth <= 0
  ) {
    return { netMarginPercent: null, fixedCostPerServiceDollars: null };
  }

  const fixedCostPerServiceDollars =
    input.monthlyFixedCostsCents / 100 / input.servicesCountThisMonth;

  const contributionDollarsPerOrder =
    (input.avgContributionMarginPercent / 100) * input.avgOrderValueDollars;

  const netDollarsPerOrder = contributionDollarsPerOrder - fixedCostPerServiceDollars;
  const netMarginPercent = (netDollarsPerOrder / input.avgOrderValueDollars) * 100;

  return {
    netMarginPercent: round2(netMarginPercent),
    fixedCostPerServiceDollars: round2(fixedCostPerServiceDollars),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

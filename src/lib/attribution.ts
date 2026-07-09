/**
 * v8.3 E10 (D.3, D.10.2) — Atribución, CAC y LTV. Funciones puras.
 *
 * LTV = ticket promedio × frecuencia mensual × margen de contribución × meses
 * de retención observados. Regla dura del spec: "Nunca mostrar LTV sin su
 * fórmula visible" — por eso `LtvResult` siempre incluye los factores, no
 * solo el número final (el caller no puede renderizar solo `.value`).
 */

export interface LtvInputs {
  avgTicketCents: number;
  monthlyFrequency: number; // servicios promedio por mes
  contributionMarginRatio: number; // 0-1
  observedRetentionMonths: number;
}

export interface LtvResult {
  valueCents: number;
  formula: string; // texto human-readable de la formula, para mostrar SIEMPRE junto al numero
  inputs: LtvInputs;
}

export function calculateLtv(inputs: LtvInputs): LtvResult {
  const valueCents = Math.round(
    inputs.avgTicketCents *
      inputs.monthlyFrequency *
      inputs.contributionMarginRatio *
      inputs.observedRetentionMonths
  );
  return {
    valueCents,
    formula: "LTV = ticket promedio × frecuencia mensual × margen de contribución × meses de retención observados",
    inputs,
  };
}

/** CAC = gasto total del canal en el periodo / clientes nuevos adquiridos en el periodo. */
export function calculateCac(totalSpendCents: number, newCustomersAcquired: number): number {
  if (newCustomersAcquired <= 0) return 0;
  return Math.round(totalSpendCents / newCustomersAcquired);
}

/** Métrica primaria del spec: CAC < LTV/3 (D.10.13). */
export function isCacHealthy(cacCents: number, ltvCents: number): boolean {
  return cacCents < ltvCents / 3;
}

export type AttributionTouch = "first" | "last";

export interface AttributionEvent {
  channel: string;
  touch: AttributionTouch;
  occurredAt: string; // ISO
}

/**
 * Separa primer y último toque por canal (D.10.2: "atribución primer + último
 * toque por separado" — nunca fusionarlos en un solo número, el spec pide
 * verlos aparte porque miden cosas distintas: descubrimiento vs. conversión).
 */
export function splitAttribution(events: AttributionEvent[]): {
  firstTouch: Record<string, number>;
  lastTouch: Record<string, number>;
} {
  const firstTouch: Record<string, number> = {};
  const lastTouch: Record<string, number> = {};
  for (const e of events) {
    const bucket = e.touch === "first" ? firstTouch : lastTouch;
    bucket[e.channel] = (bucket[e.channel] ?? 0) + 1;
  }
  return { firstTouch, lastTouch };
}

export const MARKETING_BUDGET_MIN_RATIO = 0.08;
export const MARKETING_BUDGET_MAX_RATIO = 0.10;

/**
 * Presupuesto de marketing: 8-10% del ingreso del mes anterior (configurable).
 * Devuelve el rango, no un solo número — la decisión exacta dentro del rango
 * es del admin (regla del spec: "configurable").
 */
export function calculateMarketingBudgetRange(
  previousMonthRevenueCents: number,
  minRatio: number = MARKETING_BUDGET_MIN_RATIO,
  maxRatio: number = MARKETING_BUDGET_MAX_RATIO
): { minCents: number; maxCents: number } {
  return {
    minCents: Math.round(previousMonthRevenueCents * minRatio),
    maxCents: Math.round(previousMonthRevenueCents * maxRatio),
  };
}

export interface ChannelPerformance {
  channel: string;
  cacCents: number;
  ltvCents: number;
}

/**
 * Asigna el presupuesto disponible proporcionalmente a LTV/CAC de cada canal
 * (D.10.2: "asignado por LTV/CAC del canal"). Canales con CAC=0 (sin datos
 * suficientes) quedan fuera del reparto hasta tener datos reales.
 */
export function allocateBudgetByChannel(
  totalBudgetCents: number,
  channels: ChannelPerformance[]
): Record<string, number> {
  const scored = channels
    .map((c) => ({ channel: c.channel, score: c.cacCents > 0 ? c.ltvCents / c.cacCents : 0 }))
    .filter((c) => c.score > 0);

  const totalScore = scored.reduce((sum, c) => sum + c.score, 0);
  if (totalScore === 0) return {};

  const allocation: Record<string, number> = {};
  for (const c of scored) {
    allocation[c.channel] = Math.round((c.score / totalScore) * totalBudgetCents);
  }
  return allocation;
}

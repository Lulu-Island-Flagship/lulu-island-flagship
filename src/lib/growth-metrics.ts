/**
 * v8.3 E10.13 — Métricas de crecimiento: NPS + scorecard consolidado contra
 * los umbrales del plan (funnel >15%/25%, CAC<LTV/3, churn<10%, NPS>50,
 * referidos>20%). Funciones puras, sin acceso a DB ni reloj.
 *
 * CAC<LTV/3 ya vive en attribution.ts (isCacHealthy) -- este archivo NO lo
 * duplica, solo lo re-expone como parte del scorecard consolidado.
 */

// ============================================================
// NPS — Net Promoter Score
// ============================================================

export interface NpsResponse {
  score: number; // 0-10
}

export interface NpsResult {
  npsScore: number; // -100 a 100
  promoters: number;
  passives: number;
  detractors: number;
  totalResponses: number;
}

/** Promotores 9-10, pasivos 7-8, detractores 0-6. NPS = %promotores - %detractores. */
export function computeNpsScore(responses: NpsResponse[]): NpsResult {
  const total = responses.length;
  if (total === 0) {
    return { npsScore: 0, promoters: 0, passives: 0, detractors: 0, totalResponses: 0 };
  }
  let promoters = 0;
  let passives = 0;
  let detractors = 0;
  for (const r of responses) {
    if (r.score >= 9) promoters++;
    else if (r.score >= 7) passives++;
    else detractors++;
  }
  const npsScore = Math.round(((promoters - detractors) / total) * 100);
  return { npsScore, promoters, passives, detractors, totalResponses: total };
}

// ============================================================
// Funnel de conversión (quote -> order)
// ============================================================

export type FunnelStage = "below_target" | "acceptable" | "excellent";

/** D.10.13: >15% aceptable, >25% excelente. */
export function evaluateFunnelConversionRate(quotesCreated: number, ordersBooked: number): {
  conversionRatePercent: number;
  stage: FunnelStage;
} {
  if (quotesCreated <= 0) {
    return { conversionRatePercent: 0, stage: "below_target" };
  }
  const rate = (ordersBooked / quotesCreated) * 100;
  let stage: FunnelStage = "below_target";
  if (rate > 25) stage = "excellent";
  else if (rate > 15) stage = "acceptable";
  return { conversionRatePercent: Math.round(rate * 10) / 10, stage };
}

// ============================================================
// Tasa de referidos
// ============================================================

/** D.10.13: referidos > 20% de clientes nuevos. */
export function evaluateReferralRate(newClientsTotal: number, newClientsReferred: number): {
  referralRatePercent: number;
  meetsTarget: boolean;
} {
  if (newClientsTotal <= 0) {
    return { referralRatePercent: 0, meetsTarget: false };
  }
  const rate = (newClientsReferred / newClientsTotal) * 100;
  return { referralRatePercent: Math.round(rate * 10) / 10, meetsTarget: rate > 20 };
}

// ============================================================
// Tasa de churn
// ============================================================

/** D.10.13: churn < 10%. churnedClients / totalActiveClientsStartOfPeriod. */
export function evaluateChurnRate(totalActiveClientsStartOfPeriod: number, churnedClients: number): {
  churnRatePercent: number;
  meetsTarget: boolean;
} {
  if (totalActiveClientsStartOfPeriod <= 0) {
    return { churnRatePercent: 0, meetsTarget: true };
  }
  const rate = (churnedClients / totalActiveClientsStartOfPeriod) * 100;
  return { churnRatePercent: Math.round(rate * 10) / 10, meetsTarget: rate < 10 };
}

// ============================================================
// NPS target
// ============================================================

/** D.10.13: NPS > 50. */
export function meetsNpsTarget(npsScore: number): boolean {
  return npsScore > 50;
}

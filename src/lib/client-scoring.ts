/**
 * v8.3 D.3 — Score interno de cliente. Fórmula literal del plan:
 *
 *   Score inicial: 50/100.
 *   Primer servicio sin disputa: +20.
 *   No-show: −30.
 *   Disputa perdida: −25.
 *   Score <0: ban o solo recurrente con contrato.
 *
 * El score es 100% invisible al cliente (nunca se expone en la UI pública
 * ni en la API de cliente). Solo se usa internamente para pricing rules,
 * prioridad de slots y decisiones administrativas.
 *
 * `deriveClientType` se centraliza aquí para eliminar las 5 copias
 * duplicadas que existían en quote/route.ts, quote/recalculate/route.ts,
 * quote/preview/route.ts, admin/pricing-rules/simulate/route.ts y
 * admin/phone-booking/route.ts.
 */

export const CLIENT_SCORE_INITIAL = 50;
export const CLIENT_SCORE_FIRST_SERVICE_NO_DISPUTE = 20;
export const CLIENT_SCORE_NO_SHOW_PENALTY = 30;
export const CLIENT_SCORE_DISPUTE_LOST_PENALTY = 25;

export type ClientType = "new" | "returning" | "elite";

export interface ClientScoreInput {
  /** Servicios completados sin disputa (total histórico). */
  completedServicesNoDispute: number;
  /** Total de no-shows confirmados. */
  noShowCount: number;
  /** Total de disputas perdidas (resueltas en contra del cliente). */
  disputesLostCount: number;
}

/**
 * Calcula el score interno del cliente según la fórmula D.3.
 * Puramente determinista: nunca consulta la base de datos.
 */
export function computeClientScore(input: ClientScoreInput): number {
  let score = CLIENT_SCORE_INITIAL;

  // Primer servicio completado sin disputa → +20 (una sola vez).
  if (input.completedServicesNoDispute >= 1) {
    score += CLIENT_SCORE_FIRST_SERVICE_NO_DISPUTE;
  }

  // Cada no-show confirmado → −30.
  score -= input.noShowCount * CLIENT_SCORE_NO_SHOW_PENALTY;

  // Cada disputa perdida → −25.
  score -= input.disputesLostCount * CLIENT_SCORE_DISPUTE_LOST_PENALTY;

  return score;
}

/**
 * Deriva el tipo de cliente (new/returning/elite) a partir del score y
 * el conteo de servicios. Regla literal del plan:
 *   - 0 servicios → "new"
 *   - ≥10 servicios Y score > 80 → "elite"
 *   - resto → "returning"
 */
export function deriveClientType(
  servicesCount: number,
  clientScore: number
): ClientType {
  if (servicesCount === 0) return "new";
  if (servicesCount >= 10 && clientScore > 80) return "elite";
  return "returning";
}

/**
 * Determina si un cliente califica como "recurrente" para propósitos de
 * prioridad de slots (D.8). El plan define recurrente como ≥3 servicios
 * completados sin disputa. Se usa en el date picker para ordenar
 * disponibilidad: recurrente > esporádico > nuevo.
 */
export function isRecurring(completedServicesNoDispute: number): boolean {
  return completedServicesNoDispute >= 3;
}

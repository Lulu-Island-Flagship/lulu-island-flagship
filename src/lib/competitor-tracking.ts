/**
 * v8.3 E10 (D.10.10) — Inteligencia competitiva: estructura y lógica de
 * comparación/alerta ÚNICAMENTE. No hay scraping real aquí — eso requiere
 * revisar términos de servicio de cada sitio externo antes de automatizarlo,
 * fuera del alcance de esta tanda. Esta función asume que los datos de cada
 * competidor (precio, servicios, promociones, reseñas) ya llegaron por algún
 * medio — hoy el checklist manual mensual de E1 (B.4), mañana un adaptador
 * de scraping — y ambos alimentan la MISMA tabla/forma de dato (criterio de
 * aceptación E10: "el scraping alimenta el mismo panel que el checklist
 * manual de E1 sin romperlo"). Por eso `CompetitorSnapshot` no tiene ningún
 * campo exclusivo de scraping; `source` es solo metadata de procedencia.
 */

export const MAX_TRACKED_COMPETITORS = 10;

export type CompetitorDataSource = "manual_checklist" | "scraping";

export interface CompetitorSnapshot {
  competitorId: string;
  competitorName: string;
  capturedAt: string; // ISO
  source: CompetitorDataSource;
  priceCents: number; // tarifa base representativa (ej. $/hora en centavos)
  services: string[];
  activePromotions: string[];
  averageRating: number; // 0-5
  reviewCount: number;
  zone: string; // para el benchmark de reputación por zona
}

export type CompetitorAlertType = "price_change" | "new_competitor" | "reputation_opportunity";

export interface CompetitorAlert {
  type: CompetitorAlertType;
  competitorId: string;
  competitorName: string;
  reason: string;
  severity: "info" | "warning";
}

const PRICE_CHANGE_THRESHOLD_RATIO = 0.1; // >10% dispara alerta (spec literal)
const REPUTATION_OPPORTUNITY_RATING_DROP = 0.3; // caida de rating que representa oportunidad
const REPUTATION_OPPORTUNITY_MIN_REVIEW_COUNT = 5; // evita alertar sobre ruido estadistico (pocas resenas)

/**
 * Valida que agregar un competidor nuevo no exceda el tope de 10 (spec:
 * "hasta 10 competidores"). Pura: el caller pasa el conteo actual de
 * competidores activos (no soft-deleted).
 */
export function canAddCompetitor(currentActiveCount: number): { allowed: boolean; reason?: string } {
  if (currentActiveCount >= MAX_TRACKED_COMPETITORS) {
    return {
      allowed: false,
      reason: `Ya hay ${currentActiveCount} competidores activos (tope: ${MAX_TRACKED_COMPETITORS}). Desactiva uno antes de agregar otro.`,
    };
  }
  return { allowed: true };
}

/** Cambio de precio >10% en cualquier dirección (spec no distingue alza/baja). */
function detectPriceChange(previous: CompetitorSnapshot, current: CompetitorSnapshot): CompetitorAlert | null {
  if (previous.priceCents <= 0) return null;
  const changeRatio = Math.abs(current.priceCents - previous.priceCents) / previous.priceCents;
  if (changeRatio <= PRICE_CHANGE_THRESHOLD_RATIO) return null;

  const direction = current.priceCents > previous.priceCents ? "subió" : "bajó";
  return {
    type: "price_change",
    competitorId: current.competitorId,
    competitorName: current.competitorName,
    reason: `Precio ${direction} ${(changeRatio * 100).toFixed(1)}% (de $${(previous.priceCents / 100).toFixed(2)} a $${(current.priceCents / 100).toFixed(2)}).`,
    severity: "warning",
  };
}

/** Competidor nuevo: no estaba en la lista de IDs conocidos hasta ahora. */
function detectNewCompetitor(current: CompetitorSnapshot, knownCompetitorIds: string[]): CompetitorAlert | null {
  if (knownCompetitorIds.includes(current.competitorId)) return null;
  return {
    type: "new_competitor",
    competitorId: current.competitorId,
    competitorName: current.competitorName,
    reason: `Competidor nuevo detectado en zona ${current.zone}: ${current.competitorName}.`,
    severity: "info",
  };
}

/**
 * Oportunidad de reputación: la calificación promedio del competidor cayó
 * significativamente. Umbral de conteo mínimo de reseñas para no reaccionar
 * a ruido (ej. pasar de 5.0 con 2 reseñas a 4.0 con 3 no es una señal real).
 */
function detectReputationOpportunity(previous: CompetitorSnapshot, current: CompetitorSnapshot): CompetitorAlert | null {
  if (current.reviewCount < REPUTATION_OPPORTUNITY_MIN_REVIEW_COUNT) return null;
  const drop = previous.averageRating - current.averageRating;
  if (drop < REPUTATION_OPPORTUNITY_RATING_DROP) return null;

  return {
    type: "reputation_opportunity",
    competitorId: current.competitorId,
    competitorName: current.competitorName,
    reason: `Calificación cayó de ${previous.averageRating.toFixed(1)} a ${current.averageRating.toFixed(1)} (${current.reviewCount} reseñas): oportunidad de captar clientes insatisfechos en zona ${current.zone}.`,
    severity: "info",
  };
}

/**
 * Compara un snapshot nuevo contra el anterior (mismo competidor) y contra
 * la lista de competidores ya conocidos. `previous` es null la primera vez
 * que se registra un competidor (no hay comparación de precio/reputación
 * posible, solo aplica la detección de "nuevo").
 */
export function detectCompetitorAlerts(
  current: CompetitorSnapshot,
  previous: CompetitorSnapshot | null,
  knownCompetitorIds: string[]
): CompetitorAlert[] {
  const alerts: CompetitorAlert[] = [];

  const newCompetitorAlert = detectNewCompetitor(current, knownCompetitorIds);
  if (newCompetitorAlert) alerts.push(newCompetitorAlert);

  if (previous) {
    const priceAlert = detectPriceChange(previous, current);
    if (priceAlert) alerts.push(priceAlert);

    const reputationAlert = detectReputationOpportunity(previous, current);
    if (reputationAlert) alerts.push(reputationAlert);
  }

  return alerts;
}

export interface ZoneReputationBenchmark {
  zone: string;
  ourAverageRating: number;
  competitorAverageRating: number;
  aheadOfCompetitors: boolean;
}

/**
 * Benchmark de reputación por zona (spec D.10.10). Promedia el rating de
 * todos los competidores activos en la zona y lo compara contra el nuestro.
 * Devuelve null si no hay competidores con datos en esa zona (nada que
 * comparar todavía).
 */
export function benchmarkZoneReputation(
  zone: string,
  ourAverageRating: number,
  competitorsInZone: CompetitorSnapshot[]
): ZoneReputationBenchmark | null {
  if (competitorsInZone.length === 0) return null;
  const competitorAverageRating =
    competitorsInZone.reduce((sum, c) => sum + c.averageRating, 0) / competitorsInZone.length;
  return {
    zone,
    ourAverageRating,
    competitorAverageRating: Math.round(competitorAverageRating * 100) / 100,
    aheadOfCompetitors: ourAverageRating > competitorAverageRating,
  };
}

// ------------------------------------------------------------
// v8.3 E9.13 — Precios de competencia en el panel: "Lulu $285, margen 32%
// | Comp. A $260, nuestro margen si igualamos 24% | Recomendación:
// mantener". Se simula el margen que TENDRÍAMOS si igualáramos el precio
// del competidor, usando nuestro costo REAL promedio por servicio en esa
// zona (labor + carga patronal, ya calculado en operational-accounting.ts
// -- nunca se inventa un costo). El umbral de recomendación es el mismo
// piso de margen de contribución del resto del sistema (MARGIN_FLOOR_
// PERCENT = 0.15, src/lib/pricing.ts) para no introducir un segundo
// número de "margen aceptable" en el sistema.
// ------------------------------------------------------------

export const MARGIN_RECOMMENDATION_FLOOR_PERCENT = 0.15;

export interface CompetitorMarginComparison {
  ourPriceCents: number;
  ourMarginPercent: number;
  competitorPriceCents: number;
  /** Margen que tendríamos SI igualáramos el precio del competidor, usando nuestro costo real. */
  marginIfMatchedPercent: number;
  recommendation: "maintain" | "reconsider";
  message: string;
}

/**
 * @param ourAveragePriceCents precio promedio real cobrado por nosotros en esa zona (collectedCents/orders)
 * @param ourAverageCostCents costo promedio real por servicio en esa zona (labor + carga patronal, sin igualar precio)
 * @param competitorPriceCents precio representativo del competidor
 */
export function compareMarginIfMatched(
  ourAveragePriceCents: number,
  ourAverageCostCents: number,
  competitorPriceCents: number,
  competitorName: string
): CompetitorMarginComparison | null {
  if (ourAveragePriceCents <= 0 || competitorPriceCents <= 0) return null;

  const ourMarginPercent = (ourAveragePriceCents - ourAverageCostCents) / ourAveragePriceCents;
  const marginIfMatchedPercent = (competitorPriceCents - ourAverageCostCents) / competitorPriceCents;

  const recommendation = marginIfMatchedPercent < MARGIN_RECOMMENDATION_FLOOR_PERCENT ? "reconsider" : "maintain";

  const ourPriceStr = `$${(ourAveragePriceCents / 100).toFixed(0)}`;
  const compPriceStr = `$${(competitorPriceCents / 100).toFixed(0)}`;
  const ourMarginStr = `${Math.round(ourMarginPercent * 100)}%`;
  const matchedMarginStr = `${Math.round(marginIfMatchedPercent * 100)}%`;

  const message =
    recommendation === "maintain"
      ? `Lulu ${ourPriceStr}, margin ${ourMarginStr} | ${competitorName} ${compPriceStr}, our margin if we matched: ${matchedMarginStr} | Recommendation: maintain current price.`
      : `Lulu ${ourPriceStr}, margin ${ourMarginStr} | ${competitorName} ${compPriceStr}, our margin if we matched: ${matchedMarginStr} (below the ${MARGIN_RECOMMENDATION_FLOOR_PERCENT * 100}% floor) | Recommendation: do not match — compete on value, not price.`;

  return {
    ourPriceCents: ourAveragePriceCents,
    ourMarginPercent,
    competitorPriceCents,
    marginIfMatchedPercent,
    recommendation,
    message,
  };
}

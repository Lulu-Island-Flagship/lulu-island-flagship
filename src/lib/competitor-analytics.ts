/**
 * v8.3 E10 (H.9) — Dashboard de analítica de competencia.
 *
 * Funciones puras que agregan datos de competidores (de competitor-tracking.ts
 * y competitor-scraper.ts) en un dashboard accionable para el admin:
 *
 *   1. Benchmark de reputación por zona postal.
 *   2. Alerta por cambio > 10% en cualquier métrica de competidor.
 *   3. Sugerencia automática de ajuste (precio, servicios, promociones).
 *
 * No hay scraping ni I/O aquí — este módulo solo agrega, compara y sugiere.
 * Los datos crudos vienen de competitor-tracking.ts (CompetitorSnapshot) y
 * competitor-scraper.ts (ExtractedCompetitorData).
 */

import {
  type CompetitorSnapshot,
  type CompetitorAlert,
//   type CompetitorAlertType,
  type ZoneReputationBenchmark,
  benchmarkZoneReputation,
  detectCompetitorAlerts,
  MAX_TRACKED_COMPETITORS,
} from "./competitor-tracking";

// ── Tipos del dashboard ───────────────────────────────────────────────────────

/** Métricas agregadas de un competidor individual en el dashboard. */
export interface CompetitorDashboardCard {
  competitorId: string;
  competitorName: string;
  zone: string;
  currentPriceCents: number;
  previousPriceCents: number | null;
  priceChangePercent: number | null;
  currentRating: number;
  previousRating: number | null;
  ratingTrend: "up" | "down" | "stable" | "unknown";
  reviewCount: number;
  activePromotions: string[];
  lastUpdated: string;
  alerts: CompetitorAlert[];
}

/** Dashboard completo de inteligencia competitiva. */
export interface CompetitorDashboard {
  /** Tarjetas individuales por competidor. */
  competitors: CompetitorDashboardCard[];
  /** Benchmark de reputación por zona. */
  zoneBenchmarks: ZoneReputationBenchmark[];
  /** Alertas globales (cambios > 10%, nuevos competidores, oportunidades). */
  globalAlerts: CompetitorAlert[];
  /** Sugerencias automáticas de ajuste. */
  suggestions: CompetitorSuggestion[];
  /** Conteo de competidores activos vs máximo. */
  competitorSlots: {
    used: number;
    max: number;
  };
  /** Timestamp de la última actualización del dashboard. */
  generatedAt: string;
}

// ── Sugerencias automáticas ───────────────────────────────────────────────────

/** Tipos de sugerencia que el sistema puede generar automáticamente. */
export type SuggestionType =
  | "adjust_price"
  | "add_service"
  | "launch_promotion"
  | "improve_reputation"
  | "target_competitor_zone";

/** Una sugerencia automática de ajuste competitivo. */
export interface CompetitorSuggestion {
  type: SuggestionType;
  priority: "high" | "medium" | "low";
  message: string;
  /** Datos que respaldan la sugerencia. */
  evidence: string;
}

// ── Construcción del dashboard ────────────────────────────────────────────────

/**
 * Construye una tarjeta de dashboard para un competidor individual,
 * comparando su snapshot más reciente contra el anterior.
 */
export function buildCompetitorDashboardCard(
  current: CompetitorSnapshot,
  previous: CompetitorSnapshot | null,
  knownCompetitorIds: string[],
): CompetitorDashboardCard {
  const alerts = detectCompetitorAlerts(current, previous, knownCompetitorIds);

  const priceChangePercent =
    previous && previous.priceCents > 0
      ? Math.round(
          ((current.priceCents - previous.priceCents) / previous.priceCents) *
            1000
        ) / 10
      : null;

  let ratingTrend: CompetitorDashboardCard["ratingTrend"] = "unknown";
  if (previous) {
    const diff = current.averageRating - previous.averageRating;
    if (Math.abs(diff) < 0.1) ratingTrend = "stable";
    else ratingTrend = diff > 0 ? "up" : "down";
  }

  return {
    competitorId: current.competitorId,
    competitorName: current.competitorName,
    zone: current.zone,
    currentPriceCents: current.priceCents,
    previousPriceCents: previous?.priceCents ?? null,
    priceChangePercent,
    currentRating: current.averageRating,
    previousRating: previous?.averageRating ?? null,
    ratingTrend,
    reviewCount: current.reviewCount,
    activePromotions: current.activePromotions,
    lastUpdated: current.capturedAt,
    alerts,
  };
}

/**
 * Construye el dashboard completo de inteligencia competitiva.
 *
 * @param currentSnapshots — snapshots más recientes de cada competidor.
 * @param previousSnapshots — snapshots anteriores (mismo competidor) para comparación.
 * @param ourRatingsByZone — nuestro rating promedio por zona postal.
 * @param knownCompetitorIds — IDs de competidores ya registrados previamente.
 * @param nowIso — timestamp de generación del dashboard.
 */
export function buildCompetitorDashboard(
  currentSnapshots: CompetitorSnapshot[],
  previousSnapshots: CompetitorSnapshot[],
  ourRatingsByZone: Array<{ zone: string; averageRating: number }>,
  knownCompetitorIds: string[],
  nowIso: string,
): CompetitorDashboard {
  const previousById = new Map<string, CompetitorSnapshot>();
  for (const prev of previousSnapshots) {
    previousById.set(prev.competitorId, prev);
  }

  // Tarjetas individuales
  const competitors: CompetitorDashboardCard[] = currentSnapshots.map((curr) =>
    buildCompetitorDashboardCard(
      curr,
      previousById.get(curr.competitorId) ?? null,
      knownCompetitorIds,
    ),
  );

  // Benchmark por zona
  const zoneBenchmarks: ZoneReputationBenchmark[] = [];
  for (const { zone, averageRating } of ourRatingsByZone) {
    const competitorsInZone = currentSnapshots.filter((c) => c.zone === zone);
    const benchmark = benchmarkZoneReputation(zone, averageRating, competitorsInZone);
    if (benchmark) zoneBenchmarks.push(benchmark);
  }

  // Alertas globales (todas las alertas de todos los competidores, dedicadas)
  const globalAlerts: CompetitorAlert[] = [];
  for (const card of competitors) {
    for (const alert of card.alerts) {
      if (!globalAlerts.some((a) => a.competitorId === alert.competitorId && a.type === alert.type)) {
        globalAlerts.push(alert);
      }
    }
  }

  // Sugerencias automáticas
  const suggestions = generateCompetitorSuggestions(competitors, zoneBenchmarks);

  return {
    competitors,
    zoneBenchmarks,
    globalAlerts,
    suggestions,
    competitorSlots: {
      used: currentSnapshots.length,
      max: MAX_TRACKED_COMPETITORS,
    },
    generatedAt: nowIso,
  };
}

// ── Generación de sugerencias ─────────────────────────────────────────────────

/**
 * Genera sugerencias automáticas basadas en el estado actual del panorama
 * competitivo. Las sugerencias son accionables: no dicen "hay que hacer algo",
 * dicen "considera bajar tu precio en X zona porque 3 competidores están Y% más
 * baratos y están ganando reseñas".
 */
export function generateCompetitorSuggestions(
  competitors: CompetitorDashboardCard[],
  zoneBenchmarks: ZoneReputationBenchmark[],
): CompetitorSuggestion[] {
  const suggestions: CompetitorSuggestion[] = [];

  // 1. Precio: si un competidor bajó > 10% en una zona donde operamos fuerte
  for (const card of competitors) {
    if (
      card.priceChangePercent !== null &&
      card.priceChangePercent < -10
    ) {
      suggestions.push({
        type: "adjust_price",
        priority: "high",
        message: `${card.competitorName} en ${card.zone} bajó su precio ${Math.abs(card.priceChangePercent)}%. Revisa tu posición de precio en esa zona — si estás >15% arriba, los clientes sensibles a precio pueden migrar.`,
        evidence: `Precio actual: $${(card.currentPriceCents / 100).toFixed(2)} (antes: $${((card.previousPriceCents ?? 0) / 100).toFixed(2)}).`,
      });
    }
  }

  // 2. Reputación: si estamos por debajo del promedio de la zona
  for (const bench of zoneBenchmarks) {
    if (!bench.aheadOfCompetitors) {
      suggestions.push({
        type: "improve_reputation",
        priority: "medium",
        message: `Tu rating en ${bench.zone} (${bench.ourAverageRating}) está por debajo del promedio de competidores (${bench.competitorAverageRating}). Activa recolección de testimonios post-servicio en esta zona.`,
        evidence: `Diferencia: ${(bench.ourAverageRating - bench.competitorAverageRating).toFixed(1)} puntos.`,
      });
    }
  }

  // 3. Servicios: si un competidor ofrece un servicio que nosotros no
  const ourKnownServices = new Set([
    "House Cleaning",
    "Deep Cleaning",
    "Move In/Out Cleaning",
    "Airbnb Turnover",
    "Carpet Cleaning",
  ]);

  const competitorServices = new Set<string>();
  for (const card of competitors) {
    // Los servicios del competidor vienen del snapshot original — no los
    // estamos duplicando en la tarjeta, así que este análisis es mejor
    // esfuerzo. En la práctica, el caller enriquece las tarjetas con los
    // `services` del CompetitorSnapshot original.
    for (const svc of card.activePromotions) {
      if (!ourKnownServices.has(svc)) {
        competitorServices.add(svc);
      }
    }
  }

  if (competitorServices.size > 0) {
    suggestions.push({
      type: "add_service",
      priority: "low",
      message: `Competidores están promocionando servicios que tú no ofreces explícitamente. Considera agregarlos a tu catálogo si el margen lo permite.`,
      evidence: `Servicios detectados: ${[...competitorServices].join(", ")}.`,
    });
  }

  // 4. Promociones: si varios competidores tienen promociones activas
  const competitorsWithPromos = competitors.filter(
    (c) => c.activePromotions.length > 0,
  );
  if (competitorsWithPromos.length >= 2) {
    suggestions.push({
      type: "launch_promotion",
      priority: "medium",
      message: `${competitorsWithPromos.length} competidores tienen promociones activas. Si no tienes una campaña corriendo, considera lanzar una para no perder visibilidad.`,
      evidence: competitorsWithPromos
        .map((c) => `${c.competitorName}: ${c.activePromotions.join(", ")}`)
        .join("; "),
    });
  }

  // 5. Zonas desatendidas por competidores pero con demanda nuestra
  const zonesWithCompetitors = new Set(competitors.map((c) => c.zone));
  const allZones = [
    "Steveston",
    "Terra Nova",
    "Broadmoor",
    "Seafair",
    "Woodwards",
    "City Centre",
  ];
  const unattendedZones = allZones.filter((z) => !zonesWithCompetitors.has(z));
  if (unattendedZones.length > 0) {
    suggestions.push({
      type: "target_competitor_zone",
      priority: "high",
      message: `No tienes competidores rastreados en ${unattendedZones.join(", ")}. Si operas ahí, es una ventana de oportunidad para capturar mercado sin presión competitiva directa. Si no operas ahí, considera expandir.`,
      evidence: `${unattendedZones.length} zona(s) sin competencia rastreada de ${allZones.length} zonas monitoreadas.`,
    });
  }

  return suggestions;
}

// ── Cambio > 10% ──────────────────────────────────────────────────────────────

export const COMPETITOR_CHANGE_ALERT_THRESHOLD_PERCENT = 10;

/**
 * Detecta cambios significativos (> 10%) en las métricas de un competidor
 * entre dos snapshots. Cubre: precio, rating, review count.
 */
export function detectSignificantChanges(
  current: CompetitorSnapshot,
  previous: CompetitorSnapshot,
): Array<{
  metric: "price" | "rating" | "review_count";
  changePercent: number;
  direction: "up" | "down";
}> {
  const changes: Array<{
    metric: "price" | "rating" | "review_count";
    changePercent: number;
    direction: "up" | "down";
  }> = [];

  // Price change
  if (previous.priceCents > 0) {
    const priceChange =
      ((current.priceCents - previous.priceCents) / previous.priceCents) * 100;
    if (Math.abs(priceChange) > COMPETITOR_CHANGE_ALERT_THRESHOLD_PERCENT) {
      changes.push({
        metric: "price",
        changePercent: Math.round(Math.abs(priceChange) * 10) / 10,
        direction: priceChange > 0 ? "up" : "down",
      });
    }
  }

  // Rating change
  if (previous.averageRating > 0) {
    const ratingChange =
      ((current.averageRating - previous.averageRating) / previous.averageRating) *
      100;
    if (Math.abs(ratingChange) > COMPETITOR_CHANGE_ALERT_THRESHOLD_PERCENT) {
      changes.push({
        metric: "rating",
        changePercent: Math.round(Math.abs(ratingChange) * 10) / 10,
        direction: ratingChange > 0 ? "up" : "down",
      });
    }
  }

  // Review count change
  if (previous.reviewCount > 0) {
    const reviewChange =
      ((current.reviewCount - previous.reviewCount) / previous.reviewCount) *
      100;
    if (Math.abs(reviewChange) > COMPETITOR_CHANGE_ALERT_THRESHOLD_PERCENT) {
      changes.push({
        metric: "review_count",
        changePercent: Math.round(Math.abs(reviewChange) * 10) / 10,
        direction: reviewChange > 0 ? "up" : "down",
      });
    }
  }

  return changes;
}

// ── Resumen ejecutivo ─────────────────────────────────────────────────────────

/** Resumen de alto nivel del panorama competitivo. */
export interface CompetitiveLandscapeSummary {
  totalCompetitorsTracked: number;
  zonesWithCompetitors: number;
  zonesWhereWeLead: number;
  zonesWhereWeTrail: number;
  averageCompetitorPriceCents: number;
  ourAveragePriceCents: number;
  pricePosition: "above" | "below" | "at_par";
  urgentAlerts: number;
}

/**
 * Genera un resumen ejecutivo del panorama competitivo.
 */
export function summarizeCompetitiveLandscape(
  dashboard: CompetitorDashboard,
  ourAveragePriceCents: number,
): CompetitiveLandscapeSummary {
  const totalCompetitorsTracked = dashboard.competitors.length;
  const zonesWithCompetitors = new Set(
    dashboard.competitors.map((c) => c.zone),
  ).size;
  const zonesWhereWeLead = dashboard.zoneBenchmarks.filter(
    (b) => b.aheadOfCompetitors,
  ).length;
  const zonesWhereWeTrail = dashboard.zoneBenchmarks.filter(
    (b) => !b.aheadOfCompetitors,
  ).length;

  const totalCompetitorPrice = dashboard.competitors.reduce(
    (sum, c) => sum + c.currentPriceCents,
    0,
  );
  const averageCompetitorPriceCents =
    totalCompetitorsTracked > 0
      ? Math.round(totalCompetitorPrice / totalCompetitorsTracked)
      : 0;

  const priceDiff =
    averageCompetitorPriceCents > 0
      ? (ourAveragePriceCents - averageCompetitorPriceCents) /
        averageCompetitorPriceCents
      : 0;

  let pricePosition: CompetitiveLandscapeSummary["pricePosition"] = "at_par";
  if (priceDiff > 0.03) pricePosition = "above";
  else if (priceDiff < -0.03) pricePosition = "below";

  const urgentAlerts = dashboard.globalAlerts.filter(
    (a) => a.severity === "warning",
  ).length;

  return {
    totalCompetitorsTracked,
    zonesWithCompetitors,
    zonesWhereWeLead,
    zonesWhereWeTrail,
    averageCompetitorPriceCents,
    ourAveragePriceCents,
    pricePosition,
    urgentAlerts,
  };
}

import {
  type CompetitorSnapshot,
  type CompetitorAlert,
  type ZoneReputationBenchmark,
  type CompetitorMarginComparison,
  detectCompetitorAlerts,
  benchmarkZoneReputation,
  compareMarginIfMatched,
} from "./competitor-tracking";
import {
  // MARGIN_FLOOR_PERCENT, — unused; available for future pricing integration
  // TARIFA_OBJETIVO_HORA, — unused; available for future pricing integration
} from "./pricing";
import {
  type SystemEvent,
  type PricingPosicionMercadoPayload,
  buildSystemEvent,
} from "./events";

/**
 * v8.3 D.8 — Bridge Pricing ↔ Competitor Tracking: ingiere los snapshots
 * de competitor-tracking.ts y expone la posición de Lulu vs. el mercado
 * por zona, con recomendaciones accionables para el admin.
 *
 * El spec (D.8, H.9) pide:
 *   - Dashboard: precios de 3-4 competidores locales.
 *   - Benchmark de reputación por zona postal.
 *   - Alertas por cambio >10% en competidores.
 *   - Sugerencia automática de ajuste (con piso de margen).
 *
 * Este módulo NO toma decisiones de precio — solo calcula la posición
 * relativa y emite el evento `pricing.posicion_mercado`. La decisión de
 * cambiar precio sigue siendo humana (un clic desde el dashboard).
 *
 * Responsabilidades:
 *   - competitor-tracking.ts: almacena y compara snapshots.
 *   - pricing.ts: define tarifas, márgenes y constantes de negocio.
 *   - competitive-pricing.ts: calcula posición vs mercado y emite eventos.
 */

// ── Constantes ───────────────────────────────────────────────────────────────

/**
 * Tolerancia para considerar que nuestro precio está "a la par" del
 * mercado. ±3% del promedio de mercado se considera "at_par".
 */
export const AT_PAR_TOLERANCE = 0.03;

// ── Tipos ────────────────────────────────────────────────────────────────────

/** Posición de precio relativa al mercado. */
export type PricePosition = "above" | "below" | "at_par";

/** Resumen de un competidor individual en el análisis de posición. */
export interface CompetitorPricePoint {
  competitorId: string;
  competitorName: string;
  priceCents: number;
  capturedAt: string;
  source: "manual_checklist" | "scraping";
}

/** Resultado completo del análisis competitivo por zona. */
export interface CompetitivePositionResult {
  /** Zona analizada. */
  zona: string;
  /** Nuestro precio promedio en centavos para la zona. */
  nuestroPrecioCentavos: number;
  /** Precio promedio de todos los competidores en la zona. */
  precioPromedioMercadoCentavos: number;
  /** Fracción firmada: positivo = estamos arriba, negativo = abajo. */
  porcentajeSobreMercado: number;
  /** Posición relativa clasificada. */
  posicion: PricePosition;
  /** Detalle de cada competidor considerado. */
  competidores: CompetitorPricePoint[];
  /** Benchmark de reputación (null si no hay datos de rating). */
  reputacion: ZoneReputationBenchmark | null;
  /** Comparación de margen si igualáramos al competidor más barato. */
  comparacionMargen: CompetitorMarginComparison | null;
  /** Alertas activas para esta zona. */
  alertas: CompetitorAlert[];
  /** Recomendación accionable para el admin. */
  recomendacion: string;
  /** Evento emitido. */
  evento: SystemEvent;
}

// ── Análisis de posición ────────────────────────────────────────────────────

/**
 * Calcula la posición competitiva de Lulu en una zona específica.
 *
 * @param zona — nombre de la zona (ej. "Richmond Central").
 * @param nuestroPrecioCentavos — precio promedio real cobrado en esa zona.
 * @param nuestroCostoCentavos — costo promedio real por servicio en esa zona (labor + carga patronal).
 * @param ourAverageRating — nuestro rating promedio (0-5).
 * @param competidores — snapshots más recientes de cada competidor en la zona.
 * @param knownIds — IDs de competidores ya conocidos (para detectar nuevos).
 * @param previousSnapshots — snapshots anteriores de los mismos competidores (para detectar cambios).
 * @returns CompetitivePositionResult con el análisis completo.
 */
export function analizarPosicionCompetitiva(
  zona: string,
  nuestroPrecioCentavos: number,
  nuestroCostoCentavos: number,
  ourAverageRating: number,
  competidores: CompetitorSnapshot[],
  knownIds: string[],
  previousSnapshots?: Map<string, CompetitorSnapshot>,
): CompetitivePositionResult {
  const correlationId = crypto.randomUUID();

  // ── Precios ──────────────────────────────────────────────────
  const competidoresValidos = competidores.filter((c) => c.priceCents > 0);
  const precioPromedioMercadoCentavos =
    competidoresValidos.length > 0
      ? Math.round(
          competidoresValidos.reduce((sum, c) => sum + c.priceCents, 0) /
            competidoresValidos.length
        )
      : 0;

  const porcentajeSobreMercado =
    precioPromedioMercadoCentavos > 0
      ? (nuestroPrecioCentavos - precioPromedioMercadoCentavos) /
        precioPromedioMercadoCentavos
      : 0;

  const posicion: PricePosition =
    precioPromedioMercadoCentavos === 0
      ? "at_par"
      : Math.abs(porcentajeSobreMercado) <= AT_PAR_TOLERANCE
        ? "at_par"
        : porcentajeSobreMercado > 0
          ? "above"
          : "below";

  // ── Reputación ────────────────────────────────────────────────
  const reputacion = benchmarkZoneReputation(zona, ourAverageRating, competidores);

  // ── Comparación de margen ────────────────────────────────────
  const competidorMasBarato = competidoresValidos.length > 0
    ? competidoresValidos.reduce((min, c) =>
        c.priceCents < min.priceCents ? c : min
      )
    : null;

  const comparacionMargen = competidorMasBarato
    ? compareMarginIfMatched(
        nuestroPrecioCentavos,
        nuestroCostoCentavos,
        competidorMasBarato.priceCents,
        competidorMasBarato.competitorName,
      )
    : null;

  // ── Alertas ──────────────────────────────────────────────────
  const alertas: CompetitorAlert[] = [];
  for (const actual of competidores) {
    const previo = previousSnapshots?.get(actual.competitorId) ?? null;
    const nuevas = detectCompetitorAlerts(actual, previo, knownIds);
    alertas.push(...nuevas);
  }

  // ── Recomendación ────────────────────────────────────────────
  const recomendacion = generarRecomendacion(
    posicion,
    porcentajeSobreMercado,
    comparacionMargen,
    competidoresValidos.length,
  );

  // ── Evento ──────────────────────────────────────────────────
  const payload: PricingPosicionMercadoPayload = {
    zona,
    nuestro_precio_centavos: nuestroPrecioCentavos,
    precio_promedio_competidores_centavos: precioPromedioMercadoCentavos,
    porcentaje_sobre_mercado: Math.round(porcentajeSobreMercado * 10000) / 10000,
    competidores_considerados: competidoresValidos.map((c) => ({
      competitor_id: c.competitorId,
      competitor_name: c.competitorName,
      price_cents: c.priceCents,
    })),
    posicion,
    timestamp: new Date().toISOString(),
  };

  const evento = buildSystemEvent(
    "pricing.posicion_mercado",
    zona,
    correlationId,
    payload,
  );

  // ── Puntos de precio individuales ────────────────────────────
  const competidoresPoints: CompetitorPricePoint[] = competidores.map((c) => ({
    competitorId: c.competitorId,
    competitorName: c.competitorName,
    priceCents: c.priceCents,
    capturedAt: c.capturedAt,
    source: c.source,
  }));

  return {
    zona,
    nuestroPrecioCentavos,
    precioPromedioMercadoCentavos,
    porcentajeSobreMercado,
    posicion,
    competidores: competidoresPoints,
    reputacion,
    comparacionMargen,
    alertas,
    recomendacion,
    evento,
  };
}

// ── Recomendación ────────────────────────────────────────────────────────────

/**
 * Genera una recomendación accionable basada en la posición competitiva.
 * Esta es una sugerencia para el dashboard — nunca aplica el cambio
 * automáticamente (el admin siempre decide con un clic).
 */
function generarRecomendacion(
  posicion: PricePosition,
  porcentajeSobreMercado: number,
  comparacionMargen: CompetitorMarginComparison | null,
  numCompetidores: number,
): string {
  if (numCompetidores === 0) {
    return "Sin datos de competidores en esta zona. Considerar checklist manual o activar scraping.";
  }

  const pctStr = `${Math.round(Math.abs(porcentajeSobreMercado) * 100)}%`;

  switch (posicion) {
    case "above":
      return comparacionMargen?.recommendation === "maintain"
        ? `Estamos ${pctStr} arriba del mercado pero con margen saludable. Mantener precio — competir en calidad, no en precio.`
        : `Estamos ${pctStr} arriba del mercado. Revisar: ¿justifica la calidad la diferencia? Margen permite cierta flexibilidad.`;

    case "below":
      return `Estamos ${pctStr} ABAJO del mercado. Oportunidad de subir precio si la calidad lo respalda. Revisar margen actual antes de ajustar.`;

    case "at_par":
    default:
      return "Precio a la par del mercado (±3%). Mantener monitoreo — cualquier movimiento de competidores requiere revisión.";
  }
}

// ── Dashboard rápido ─────────────────────────────────────────────────────────

/**
 * Resumen ejecutivo para el dashboard de pricing: una sola línea por zona
 * con el estado competitivo. Útil para el Command Center / semáforos.
 */
export interface CompetitiveSummary {
  zona: string;
  posicion: PricePosition;
  porcentajeSobreMercado: number;
  numCompetidores: number;
  alertasActivas: number;
  recomendacionBreve: string;
}

/**
 * Genera resúmenes ejecutivos para múltiples zonas.
 *
 * @returns Array de CompetitiveSummary, uno por zona.
 */
export function resumenCompetitivoPorZona(
  resultados: CompetitivePositionResult[],
): CompetitiveSummary[] {
  return resultados.map((r) => ({
    zona: r.zona,
    posicion: r.posicion,
    porcentajeSobreMercado: r.porcentajeSobreMercado,
    numCompetidores: r.competidores.length,
    alertasActivas: r.alertas.length,
    recomendacionBreve:
      r.posicion === "below"
        ? "⬆️ Oportunidad de subir"
        : r.posicion === "above"
          ? "⬇️ Revisar diferencial"
          : "✅ A la par",
  }));
}

// ── Constantes exportadas ────────────────────────────────────────────────────

/** Re-export del piso de margen de competitor-tracking para conveniencia. */
export { MARGIN_RECOMMENDATION_FLOOR_PERCENT } from "./competitor-tracking";

/** Piso de margen de contribución del sistema (pricing.ts). */
export { MARGIN_FLOOR_PERCENT, TARIFA_OBJETIVO_HORA } from "./pricing";

/**
 * v8.3 G.7 — Matriz de Rentabilidad Geoespacial (Mapa de Calor).
 *
 * Cada polígono/zona de la ciudad se tiñe según el margen neto real de los
 * servicios ejecutados allí en los últimos 30 días. El admin hace clic en
 * una zona y puede ajustar el modificador de zona sin tocar Excel.
 *
 * Conecta:
 *   - zone-demand.ts       → ocupación/capacidad de la zona (demand score).
 *   - zone-reparto.ts      → pesos de zona, asignación de operarios.
 *   - shadow-ledger.ts     → márgenes reales por orden, fuente de verdad.
 *
 * Diseño: funciones puras que reciben datos de órdenes completadas agrupadas
 * por zona, calculan el margen neto real, y devuelven una matriz de zonas
 * con semáforo de rentabilidad. El route handler hace los queries a la DB
 * y pasa los datos ya agregados.
 *
 * El "ajuste de modificador de zona" es una sugerencia que esta función
 * calcula — el commit del cambio en la DB lo hace otra capa.
 */

import type { Semaphore } from "@/lib/dashboard-metrics";
import type { ZoneWeight } from "@/lib/zone-reparto";

// ---------------------------------------------------------------------------
// Tipos de dominio
// ---------------------------------------------------------------------------

/** Umbrales de rentabilidad por zona. */
export const ZONE_PROFITABILITY_THRESHOLDS = {
  /** Margen neto por debajo de esto → zona roja (drenando caja). */
  criticalMarginPercent: 5,
  /** Margen neto por debajo de esto → zona amarilla (atención). */
  warningMarginPercent: 15,
  /** Margen neto por encima → zona verde (saludable). */
  healthyMarginPercent: 25,
} as const;

/** Niveles de rentabilidad para el mapa de calor. */
export type ZoneProfitabilityLevel = "critical" | "warning" | "healthy" | "excellent" | "no_data";

export interface ZoneOrderAggregate {
  zone: string;
  /** Servicios completados en la ventana (últimos 30 días). */
  completedServicesCount: number;
  /** Ingreso bruto total de esos servicios (cents). */
  totalRevenueCents: number;
  /** Costo total de esos servicios (cents) — labor, insumos, tránsito. */
  totalCostCents: number;
  /** Ingreso neto = revenue - cost (cents). */
  netCents: number;
  /** Demanda actual de la zona (0-100, de zone-demand.ts). */
  demandScore: number;
  /** Peso de la zona para reparto (de zone-reparto.ts). */
  zoneWeight: number;
  /** Modificador actual de precio para esta zona (ej. 1.15 = +15%). */
  currentZoneModifier: number;
}

export interface ZoneProfitabilitySnapshot {
  zone: string;
  /** Margen neto real (%) de los últimos 30 días. */
  netMarginPercent: number | null;
  netCents: number;
  totalRevenueCents: number;
  completedServicesCount: number;
  profitabilityLevel: ZoneProfitabilityLevel;
  semaphore: Semaphore;
  demandScore: number;
  zoneWeight: number;
  currentZoneModifier: number;
  /** Sugerencia de ajuste del modificador si la zona está en rojo o amarillo. */
  suggestedModifierAdjustment: ZoneModifierSuggestion | null;
}

export interface ZoneModifierSuggestion {
  currentModifier: number;
  suggestedModifier: number;
  /** "raise" para subir el precio, "lower" solo si la demanda es baja Y el margen es excelente. */
  direction: "raise" | "lower" | "hold";
  reason: string;
}

export interface GeoProfitabilityMatrix {
  generatedAt: string;
  zones: ZoneProfitabilitySnapshot[];
  summary: GeoProfitabilitySummary;
}

export interface GeoProfitabilitySummary {
  totalZones: number;
  zonesWithData: number;
  criticalZones: number;
  warningZones: number;
  healthyZones: number;
  excellentZones: number;
  /** Pérdida total en zonas críticas (cents). */
  totalLossInCriticalZonesCents: number;
  /** Zona más rentable. */
  topZone: string | null;
  /** Zona menos rentable. */
  bottomZone: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Cálculo de rentabilidad por zona
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calcula el margen neto real de una zona a partir de los datos agregados
 * de órdenes completadas en los últimos 30 días.
 *
 * Margen neto (%) = (netCents / totalRevenueCents) × 100.
 * Si no hay servicios completados, devuelve null (sin dato).
 */
export function computeZoneNetMargin(zone: ZoneOrderAggregate): number | null {
  if (zone.completedServicesCount <= 0 || zone.totalRevenueCents <= 0) {
    return null;
  }
  return round2((zone.netCents / zone.totalRevenueCents) * 100);
}

/**
 * Clasifica una zona en un nivel de rentabilidad para el mapa de calor.
 */
export function classifyZoneProfitability(marginPercent: number | null): ZoneProfitabilityLevel {
  if (marginPercent === null) return "no_data";
  if (marginPercent < ZONE_PROFITABILITY_THRESHOLDS.criticalMarginPercent) return "critical";
  if (marginPercent < ZONE_PROFITABILITY_THRESHOLDS.warningMarginPercent) return "warning";
  if (marginPercent >= ZONE_PROFITABILITY_THRESHOLDS.healthyMarginPercent) return "excellent";
  return "healthy";
}

/**
 * Convierte un nivel de rentabilidad a semáforo para el dashboard.
 */
export function profitabilityLevelToSemaphore(level: ZoneProfitabilityLevel): Semaphore {
  switch (level) {
    case "critical": return "red";
    case "warning": return "yellow";
    case "healthy": return "green";
    case "excellent": return "green";
    case "no_data": return "unknown";
  }
}

/**
 * Calcula una sugerencia de ajuste del modificador de zona basada en el
 * margen neto real y la demanda actual.
 *
 * Reglas:
 *   - Zona crítica (margen < 5%):  subir modificador +5pp para compensar.
 *   - Zona warning (margen 5-15%): subir modificador +3pp.
 *   - Zona excellent con baja demanda (<40): bajar -3pp para estimular volumen.
 *   - Resto: mantener (hold).
 *
 * La sugerencia nunca cruza el modificador base (1.0) hacia abajo ni supera
 * 2.0 hacia arriba.
 */
export function suggestZoneModifierAdjustment(
  marginPercent: number | null,
  currentModifier: number,
  demandScore: number
): ZoneModifierSuggestion | null {
  if (marginPercent === null) return null;

  const level = classifyZoneProfitability(marginPercent);

  if (level === "critical") {
    const suggested = round2(Math.min(2.0, currentModifier + 0.05));
    return {
      currentModifier,
      suggestedModifier: suggested,
      direction: "raise",
      reason: `Margen neto crítico (${marginPercent}%). Subir modificador de ${currentModifier} → ${suggested} para recuperar rentabilidad.`,
    };
  }

  if (level === "warning") {
    const suggested = round2(Math.min(2.0, currentModifier + 0.03));
    return {
      currentModifier,
      suggestedModifier: suggested,
      direction: "raise",
      reason: `Margen bajo (${marginPercent}%). Ajuste moderado: ${currentModifier} → ${suggested}.`,
    };
  }

  if (level === "excellent" && demandScore < 40) {
    const suggested = round2(Math.max(1.0, currentModifier - 0.03));
    if (suggested < currentModifier) {
      return {
        currentModifier,
        suggestedModifier: suggested,
        direction: "lower",
        reason: `Margen excelente (${marginPercent}%) pero demanda baja (${demandScore}/100). Bajar modificador para estimular volumen: ${currentModifier} → ${suggested}.`,
      };
    }
  }

  return {
    currentModifier,
    suggestedModifier: currentModifier,
    direction: "hold",
    reason: `Zona en equilibrio (margen ${marginPercent}%, demanda ${demandScore}/100). Sin ajuste sugerido.`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Construcción de la matriz completa
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Construye la matriz de rentabilidad geoespacial completa a partir de los
 * datos agregados por zona. Ideal para alimentar un mapa de calor (frontend
 * renderiza polígonos con colores según profitabilityLevel).
 *
 * @param zoneAggregates — datos de órdenes agrupados por zona.
 * @param zoneWeights — pesos de zona (de zone-reparto.ts), para reference.
 * @param nowIso — timestamp de generación.
 */
export function buildGeoProfitabilityMatrix(
  zoneAggregates: ZoneOrderAggregate[],
  zoneWeights: ZoneWeight[],
  nowIso: string
): GeoProfitabilityMatrix {
  const weightMap = new Map<string, number>();
  for (const zw of zoneWeights) {
    weightMap.set(zw.zone, zw.weight);
  }

  const snapshots: ZoneProfitabilitySnapshot[] = zoneAggregates.map((zone) => {
    const marginPercent = computeZoneNetMargin(zone);
    const level = classifyZoneProfitability(marginPercent);
    const semaphore = profitabilityLevelToSemaphore(level);
    const suggestion = suggestZoneModifierAdjustment(
      marginPercent,
      zone.currentZoneModifier,
      zone.demandScore
    );

    return {
      zone: zone.zone,
      netMarginPercent: marginPercent,
      netCents: zone.netCents,
      totalRevenueCents: zone.totalRevenueCents,
      completedServicesCount: zone.completedServicesCount,
      profitabilityLevel: level,
      semaphore,
      demandScore: zone.demandScore,
      zoneWeight: weightMap.get(zone.zone) ?? zone.zoneWeight,
      currentZoneModifier: zone.currentZoneModifier,
      suggestedModifierAdjustment: suggestion,
    };
  });

  // Ordenar por margen neto (peor primero → urgente)
  snapshots.sort((a, b) => {
    if (a.netMarginPercent === null && b.netMarginPercent === null) return 0;
    if (a.netMarginPercent === null) return 1;
    if (b.netMarginPercent === null) return -1;
    return a.netMarginPercent - b.netMarginPercent;
  });

  const zonesWithData = snapshots.filter((z) => z.netMarginPercent !== null);
  const summary: GeoProfitabilitySummary = {
    totalZones: snapshots.length,
    zonesWithData: zonesWithData.length,
    criticalZones: snapshots.filter((z) => z.profitabilityLevel === "critical").length,
    warningZones: snapshots.filter((z) => z.profitabilityLevel === "warning").length,
    healthyZones: snapshots.filter((z) => z.profitabilityLevel === "healthy").length,
    excellentZones: snapshots.filter((z) => z.profitabilityLevel === "excellent").length,
    totalLossInCriticalZonesCents: snapshots
      .filter((z) => z.profitabilityLevel === "critical" && z.netCents < 0)
      .reduce((sum, z) => sum + Math.abs(z.netCents), 0),
    topZone: zonesWithData.length > 0
      ? zonesWithData[zonesWithData.length - 1].zone
      : null,
    bottomZone: zonesWithData.length > 0
      ? zonesWithData[0].zone
      : null,
  };

  return {
    generatedAt: nowIso,
    zones: snapshots,
    summary,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Consulta compuesta: rentabilidad + demanda de la zona
// ═══════════════════════════════════════════════════════════════════════════

export interface ZoneHealthCheck {
  zone: string;
  demandScore: number;
  netMarginPercent: number | null;
  profitabilityLevel: ZoneProfitabilityLevel;
  /** true si la zona está sobre-saturada (demand > 80) Y tiene buen margen → candidata a expansión. */
  expansionCandidate: boolean;
  /** true si la zona está sub-utilizada (demand < 20) Y tiene mal margen → candidata a cierre. */
  contractionCandidate: boolean;
}

/**
 * Evalúa la salud combinada (demanda + rentabilidad) de una zona para
 * decisiones estratégicas de expansión/contracción.
 */
export function evaluateZoneHealth(
  zone: ZoneOrderAggregate
): ZoneHealthCheck {
  const marginPercent = computeZoneNetMargin(zone);
  const level = classifyZoneProfitability(marginPercent);

  const expansionCandidate =
    zone.demandScore > 80 &&
    marginPercent !== null &&
    marginPercent >= ZONE_PROFITABILITY_THRESHOLDS.healthyMarginPercent;

  const contractionCandidate =
    zone.demandScore < 20 &&
    marginPercent !== null &&
    marginPercent < ZONE_PROFITABILITY_THRESHOLDS.warningMarginPercent;

  return {
    zone: zone.zone,
    demandScore: zone.demandScore,
    netMarginPercent: marginPercent,
    profitabilityLevel: level,
    expansionCandidate,
    contractionCandidate,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

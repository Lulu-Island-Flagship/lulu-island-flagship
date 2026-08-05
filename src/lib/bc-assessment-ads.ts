/**
 * v8.3 E10 (H.6) — Publicidad predictiva basada en BC Assessment.
 *
 * Estrategia: si BC Assessment indica que hay un clúster de casas de la misma
 * década constructiva en un barrio, se dispara publicidad hiper-segmentada que
 * habla el idioma específico de ese tipo de propiedad.
 *
 * Ejemplo:
 *   "Es temporada de lluvia en Steveston. ¿Hace cuánto no desinfecta los pisos
 *    de madera de su casa original de 1990?"
 *
 * La idea es vender preservación del patrimonio — no limpieza genérica. Una casa
 * de 1990 con pisos de madera originales necesita mantenimiento especializado que
 * el dueño quizás no sabe que necesita. El anuncio no dice "contrate limpieza",
 * dice "proteja su inversión".
 *
 * Conecta bc-assessment.ts para obtener datos de propiedad (año de construcción,
 * superficie) y construir el targeting por década.
 */

import {
  // type BcAssessmentResult,
  // lookupBcAssessment,
} from "./bc-assessment";

// ── Décadas constructivas ─────────────────────────────────────────────────────

/** Décadas constructivas que rastreamos para targeting. */
export type ConstructionDecade =
  | "pre_1960"
  | "1960s"
  | "1970s"
  | "1980s"
  | "1990s"
  | "2000s"
  | "2010s"
  | "2020s";

/** Mapea un año de construcción a su década. */
export function yearToDecade(year: number): ConstructionDecade {
  if (year < 1960) return "pre_1960";
  if (year < 1970) return "1960s";
  if (year < 1980) return "1970s";
  if (year < 1990) return "1980s";
  if (year < 2000) return "1990s";
  if (year < 2010) return "2000s";
  if (year < 2020) return "2010s";
  return "2020s";
}

// ── Características de propiedad por década ───────────────────────────────────

/**
 * Rasgos típicos de casas en Richmond BC por década constructiva.
 * Estos datos informan la generación de copy publicitario: no son datos
 * individuales de ninguna propiedad real, son patrones arquitectónicos
 * de la región.
 */
export interface DecadeCharacteristics {
  decade: ConstructionDecade;
  label: string;
  typicalFeatures: string[];
  vulnerabilityNote: string;
}

/** Catálogo de características por década para Richmond BC. */
export const RICHMOND_DECADE_CHARACTERISTICS: Record<
  ConstructionDecade,
  DecadeCharacteristics
> = {
  pre_1960: {
    decade: "pre_1960",
    label: "anterior a 1960",
    typicalFeatures: [
      "pisos de madera original",
      "molduras de época",
      "ventanas de marco de madera",
    ],
    vulnerabilityNote:
      "Las casas pre-1960 en Richmond suelen tener pisos de madera original que requieren cuidado especializado contra la humedad del Fraser.",
  },
  "1960s": {
    decade: "1960s",
    label: "de los 60",
    typicalFeatures: [
      "pisos de terrazo o linóleo original",
      "gabinetes de madera sólida",
      "baños con azulejos originales",
    ],
    vulnerabilityNote:
      "Los acabados originales de los 60 son difíciles de reemplazar; el mantenimiento preventivo es clave.",
  },
  "1970s": {
    decade: "1970s",
    label: "de los 70",
    typicalFeatures: [
      "alfombras wall-to-wall",
      "paneles de madera",
      "ventanas de aluminio",
    ],
    vulnerabilityNote:
      "Las alfombras de los 70 acumulan alérgenos profundos que la aspiración normal no extrae.",
  },
  "1980s": {
    decade: "1980s",
    label: "de los 80",
    typicalFeatures: [
      "pisos de parquet",
      "mesones de formica",
      "baños con jacuzzi original",
    ],
    vulnerabilityNote:
      "El parquet de los 80 se deforma con la humedad de Richmond; requiere sellado profesional periódico.",
  },
  "1990s": {
    decade: "1990s",
    label: "de los 90",
    typicalFeatures: [
      "pisos de madera de ingeniería",
      "cocinas con isla",
      "baños con tina separada",
    ],
    vulnerabilityNote:
      "Los pisos de madera de ingeniería de los 90 necesitan desinfección profunda que no dañe la capa de acabado.",
  },
  "2000s": {
    decade: "2000s",
    label: "de los 2000",
    typicalFeatures: [
      "pisos de laminado premium",
      "mesones de granito",
      "electrodomésticos integrados",
    ],
    vulnerabilityNote:
      "El laminado premium requiere productos específicos; un producto incorrecto daña el acabado irreversiblemente.",
  },
  "2010s": {
    decade: "2010s",
    label: "de los 2010",
    typicalFeatures: [
      "pisos de vinilo de lujo",
      "mesones de cuarzo",
      "sistemas de ventilación HRV",
    ],
    vulnerabilityNote:
      "Los sistemas HRV requieren limpieza de ductos cada 2-3 años para mantener eficiencia.",
  },
  "2020s": {
    decade: "2020s",
    label: "de los 2020",
    typicalFeatures: [
      "acabados de alta eficiencia energética",
      "materiales compuestos",
      "domótica integrada",
    ],
    vulnerabilityNote:
      "Las casas nuevas necesitan un régimen de limpieza que proteja las garantías de materiales.",
  },
};

// ── Clúster de propiedades ────────────────────────────────────────────────────

/** Un clúster de propiedades de la misma década en una zona. */
export interface PropertyCluster {
  zone: string;
  decade: ConstructionDecade;
  propertyCount: number;
  /** Propiedades individuales con datos de BC Assessment (si disponibles). */
  properties: Array<{
    address: string;
    constructionYear: number;
    squareFeet?: number;
  }>;
}

// ── Generación de copy publicitario ────────────────────────────────────────────

/** Estaciones que afectan el copy del anuncio. */
export type SeasonalContext =
  | "rainy_season"
  | "spring"
  | "summer"
  | "fall"
  | "winter";

/**
 * Determina la estación actual para Richmond BC según el mes.
 *
 * - Rainy season: Octubre a Marzo (la lluvia en Vancouver/Richmond es intensa).
 * - Spring: Abril-Mayo.
 * - Summer: Junio-Agosto.
 * - Fall: Septiembre.
 */
export function getSeasonalContext(month: number): SeasonalContext {
  if (month >= 10 || month <= 3) return "rainy_season";
  if (month <= 5) return "spring";
  if (month <= 8) return "summer";
  return "fall";
}

/** Un anuncio predictivo listo para servir. */
export interface PredictiveAd {
  /** Título del anuncio (30-90 caracteres para Meta/Google Ads). */
  headline: string;
  /** Cuerpo del anuncio. */
  body: string;
  /** Call to action. */
  cta: string;
  /** Zona objetivo. */
  targetZone: string;
  /** Década objetivo. */
  targetDecade: ConstructionDecade;
  /** Estación en que se generó. */
  seasonalContext: SeasonalContext;
  /** Keywords de targeting. */
  keywords: string[];
}

/**
 * Genera el copy de un anuncio predictivo basado en la década de la casa
 * y el contexto estacional. La fórmula es:
 *
 *   [Contexto estacional en zona] + [Característica vulnerable de la década]
 *   + [Pregunta que detona conciencia] + [CTA]
 */
export function generatePredictiveAdCopy(
  zone: string,
  decade: ConstructionDecade,
  month: number,
): PredictiveAd {
  const chars = RICHMOND_DECADE_CHARACTERISTICS[decade];
  const season = getSeasonalContext(month);

  const feature = chars.typicalFeatures[0] ?? "su hogar";

  // Headlines y bodies por estación + década
  const seasonalPrefix: Record<SeasonalContext, string> = {
    rainy_season: `Es temporada de lluvia en ${zone}`,
    spring: `La primavera llegó a ${zone}`,
    summer: `El verano en ${zone} trae huéspedes`,
    fall: `El otoño en ${zone} es momento de preparar`,
    winter: `Este invierno en ${zone}, proteja`,
  };

  const seasonalQuestion: Record<SeasonalContext, string> = {
    rainy_season: `¿Hace cuánto no desinfecta los ${feature} de su casa original ${chars.label}?`,
    spring: `¿Sus ${feature} están listos para la temporada de alergias?`,
    summer: `¿Sus ${feature} resistirán el tráfico de visitas?`,
    fall: `¿Sus ${feature} antes de las fiestas de fin de año?`,
    winter: `¿Sus ${feature} del frío y la humedad?`,
  };

  const headline = `${seasonalPrefix[season]}. ${seasonalQuestion[season]}`;

  const body = `${chars.vulnerabilityNote} En Lulu Island Flagship conocemos las casas ${chars.label} de ${zone} — hemos limpiado ${chars.typicalFeatures.join(", ")} en este vecindario.`;

  const keywords = [
    `house cleaning ${zone}`,
    `${decade} home maintenance Richmond`,
    `${feature} cleaning Richmond BC`,
    "Lulu Island Flagship",
  ];

  return {
    headline: headline.slice(0, 90),
    body,
    cta: "Solicitar cotización",
    targetZone: zone,
    targetDecade: decade,
    seasonalContext: season,
    keywords,
  };
}

// ── Detección de clúster ──────────────────────────────────────────────────────

/**
 * Agrupa propiedades por zona y década para detectar clústeres.
 * Un clúster es un grupo de ≥ 3 propiedades de la misma década en la misma
 * zona — suficiente para justificar una campaña dirigida.
 */
export function detectPropertyClusters(
  properties: Array<{
    address: string;
    constructionYear: number;
    zone: string;
    squareFeet?: number;
  }>,
  minClusterSize = 3,
): PropertyCluster[] {
  const groups = new Map<string, PropertyCluster>();

  for (const prop of properties) {
    const decade = yearToDecade(prop.constructionYear);
    const key = `${prop.zone}::${decade}`;

    let cluster = groups.get(key);
    if (!cluster) {
      cluster = {
        zone: prop.zone,
        decade,
        propertyCount: 0,
        properties: [],
      };
      groups.set(key, cluster);
    }

    cluster.propertyCount++;
    cluster.properties.push({
      address: prop.address,
      constructionYear: prop.constructionYear,
      squareFeet: prop.squareFeet,
    });
  }

  return [...groups.values()].filter((c) => c.propertyCount >= minClusterSize);
}

/**
 * Calcula un score de oportunidad para un clúster (0-100).
 * Mayor score = más valioso para targeting publicitario.
 *
 * Factores:
 *   - Tamaño del clúster (más propiedades = más audiencia).
 *   - Antigüedad (más antiguo = más necesidad de mantenimiento).
 *   - Superficie promedio (más grande = ticket más alto).
 */
export function scoreClusterOpportunity(cluster: PropertyCluster): number {
  // Tamaño: 3-5 → 30pts, 6-10 → 60pts, 11+ → 100pts
  const sizeScore = Math.min(100, cluster.propertyCount * 10);

  // Antigüedad: pre_1960 → 100, 2020s → 10
  const decadeOrder: ConstructionDecade[] = [
    "pre_1960",
    "1960s",
    "1970s",
    "1980s",
    "1990s",
    "2000s",
    "2010s",
    "2020s",
  ];
  const decadeIndex = decadeOrder.indexOf(cluster.decade);
  const ageScore = decadeIndex >= 0 ? 100 - decadeIndex * 12.5 : 50;

  // Superficie: promedio > 2000 sqft = ticket alto
  const avgSqft =
    cluster.properties.reduce((sum, p) => sum + (p.squareFeet ?? 0), 0) /
    cluster.properties.length;
  const sizeBonus = avgSqft > 2000 ? 20 : avgSqft > 1500 ? 10 : 0;

  return Math.min(100, Math.round((sizeScore + ageScore) / 2 + sizeBonus));
}

// ── Targeting de audiencias ───────────────────────────────────────────────────

/**
 * Determina si un clúster justifica inversión publicitaria.
 * Score mínimo: 40 (clúster pequeño de casas modernas no vale la pena).
 */
export function isClusterWorthTargeting(cluster: PropertyCluster): {
  worthIt: boolean;
  score: number;
  reason: string;
} {
  const score = scoreClusterOpportunity(cluster);

  if (score < 40) {
    return {
      worthIt: false,
      score,
      reason: `Score de oportunidad ${score}/100 es bajo — clúster de ${cluster.propertyCount} propiedades ${cluster.decade} en ${cluster.zone}.`,
    };
  }

  return {
    worthIt: true,
    score,
    reason: `Clúster viable: ${cluster.propertyCount} propiedades ${cluster.decade} en ${cluster.zone}. Score: ${score}/100.`,
  };
}

// ── ROI de campañas predictivas ───────────────────────────────────────────────

/** Métricas de una campaña de anuncios predictivos. */
export interface PredictiveAdMetrics {
  /** Impresiones servidas. */
  impressions: number;
  /** Clics en el anuncio. */
  clicks: number;
  /** Cotizaciones iniciadas desde el anuncio. */
  quotesStarted: number;
  /** Órdenes concretadas. */
  ordersBooked: number;
  /** Costo total de la campaña (centavos). */
  campaignCostCents: number;
  /** Ingreso generado (centavos). */
  revenueGeneratedCents: number;
}

/**
 * Calcula el ROI de una campaña de anuncios predictivos.
 */
export function calculatePredictiveAdRoi(
  metrics: PredictiveAdMetrics,
): {
  roiPercent: number;
  ctrPercent: number;
  conversionRatePercent: number;
  cpaCents: number;
} {
  const ctrPercent =
    metrics.impressions > 0
      ? Math.round((metrics.clicks / metrics.impressions) * 1000) / 10
      : 0;

  const conversionRatePercent =
    metrics.clicks > 0
      ? Math.round((metrics.ordersBooked / metrics.clicks) * 1000) / 10
      : 0;

  const cpaCents =
    metrics.ordersBooked > 0
      ? Math.round(metrics.campaignCostCents / metrics.ordersBooked)
      : 0;

  const roiPercent =
    metrics.campaignCostCents > 0
      ? Math.round(
          ((metrics.revenueGeneratedCents - metrics.campaignCostCents) /
            metrics.campaignCostCents) *
            100
        )
      : 0;

  return { roiPercent, ctrPercent, conversionRatePercent, cpaCents };
}

/**
 * v8.3 E10 (D.10.11, H.1) — Pipeline SEO automatizado.
 *
 * Flujo completo: keyword research local → calendario editorial estacional →
 * templates con schema LocalBusiness → landing pages dinámicas por zona vía
 * Next.js ISR. Conecta blog-content.ts (generación de posts PIPA-validados) +
 * gbp-checklist.ts (checklist SEO local / Google Business Profile).
 *
 * Las landing pages dinámicas por zona postal son la pieza central del SEO
 * local: en vez de una sola página genérica "servicio de limpieza en Richmond",
 * el sistema genera una por zona real (ej. "limpieza de casas en Steveston",
 * "house cleaning in Terra Nova") con datos reales del portafolio: cantidad de
 * servicios recientes en esa zona, score promedio del equipo que opera ahí, y
 * badges de garantía verificados. Next.js ISR regenera cada página cada 24h
 * (revalidate: 86400) — los datos del portafolio cambian, el SEO no se estanca.
 */

import {
  type BlogPost,
  evaluatePostForApproval,
  type PostEvaluationResult,
} from "./blog-content";
import { type GbpChecklistItem, type GbpFrequency } from "./gbp-checklist";

// ── Zonas postales de Richmond BC ─────────────────────────────────────────────

/** Zonas del área de servicio con datos de portafolio real. */
export const RICHMOND_ZONES = [
  "Steveston",
  "Terra Nova",
  "Broadmoor",
  "Seafair",
  "Woodwards",
  "McLennan",
  "Bridgeport",
  "City Centre",
  "East Richmond",
  "Hamilton",
] as const;

export type RichmondZone = (typeof RICHMOND_ZONES)[number];

// ── Keyword Research ──────────────────────────────────────────────────────────

/** Volumen de búsqueda estimado para una keyword local. */
export interface KeywordEstimate {
  keyword: string;
  zone: RichmondZone | "all";
  monthlySearchVolume: number;
  competitionLevel: "low" | "medium" | "high";
  seasonalPeak?: string; // ej. "spring", "move-out"
}

/** Categorías de servicio que alimentan las keywords. */
export type ServiceKeywordCategory =
  | "house_cleaning"
  | "deep_cleaning"
  | "move_in_out"
  | "airbnb_turnover"
  | "carpet_cleaning"
  | "post_renovation"
  | "senior_home_care";

/**
 * Genera keywords locales a partir de la combinación zona × categoría.
 * El keyword research es determinista: no inventa volúmenes de búsqueda
 * sin fuente externa — si no hay datos de terceros (Google Ads Keyword
 * Planner, Ahrefs, etc.), `monthlySearchVolume` queda en 0 y el sistema
 * lo muestra como "sin datos — priorizar después".
 *
 * El spec (H.1) pide "keyword research local". Esta función produce la
 * matriz combinatoria completa; el caller (API route) es responsable de
 * enriquecerla con datos de volumen externos si existen.
 */
export function generateLocalKeywordMatrix(
  zones: readonly RichmondZone[],
  categories: readonly ServiceKeywordCategory[],
): KeywordEstimate[] {
  const matrix: KeywordEstimate[] = [];

  for (const zone of zones) {
    for (const category of categories) {
      const label = category.replace(/_/g, " ");
      matrix.push({
        keyword: `${label} ${zone}`,
        zone,
        monthlySearchVolume: 0, // requiere fuente externa
        competitionLevel: "medium",
      });
    }
  }

  // Keywords de cobertura amplia (toda la ciudad)
  for (const category of categories) {
    const label = category.replace(/_/g, " ");
    matrix.push({
      keyword: `${label} Richmond BC`,
      zone: "all",
      monthlySearchVolume: 0,
      competitionLevel: "high",
    });
  }

  return matrix;
}

/**
 * Calcula un score de prioridad para cada keyword (0-100). Mayor score =
 * mayor prioridad de contenido. Fórmula: volumen × (1 - competencia) ×
 * factor estacional. Keywords con `all` de zona reciben un leve castigo
 * porque compiten con resultados genéricos.
 */
export function scoreKeywordPriority(keyword: KeywordEstimate, currentMonth: number): number {
  const competitionMultiplier =
    keyword.competitionLevel === "low" ? 1.0 : keyword.competitionLevel === "medium" ? 0.65 : 0.3;

  const zoneMultiplier = keyword.zone === "all" ? 0.7 : 1.0;

  // Pico estacional: si la keyword tiene pico y estamos en ese mes, boost ×1.5
  let seasonalMultiplier = 1.0;
  if (keyword.seasonalPeak) {
    const peakMonths: Record<string, number[]> = {
      spring: [3, 4, 5],
      "move-out": [4, 5, 6],
      summer: [7, 8],
      "pre-holiday": [10, 11],
      "gift-cards": [11, 12],
    };
    const months = peakMonths[keyword.seasonalPeak] ?? [];
    if (months.includes(currentMonth)) {
      seasonalMultiplier = 1.5;
    }
  }

  const rawScore =
    keyword.monthlySearchVolume * competitionMultiplier * zoneMultiplier * seasonalMultiplier;

  // Normalizar a 0-100 (asumiendo volúmenes máximos realistas de ~5000)
  return Math.min(100, Math.round((rawScore / 5000) * 100));
}

// ── Calendario Editorial Estacional ───────────────────────────────────────────

/** Entrada del calendario editorial: tema + keyword objetivo + ventana. */
export interface EditorialSlot {
  month: number; // 1-12
  topicSeed: string;
  targetKeyword: string;
  targetZone: RichmondZone | "all";
  /** El slot puede generar múltiples posts (ej. uno por zona prioritaria). */
  expansionZones: RichmondZone[];
}

/**
 * Calendario editorial pre-cargado para Richmond BC, alineado con el
 * calendario de campañas estacionales (campaign-scheduler.ts). Un tema
 * por mes; algunos meses tienen múltiples slots (ej. marzo = Spring
 * Cleaning que se replica por varias zonas).
 */
export function getRichmondEditorialCalendar(): EditorialSlot[] {
  return [
    {
      month: 1,
      topicSeed: "Organización post-fiestas: cómo mantener tu hogar impecable en el invierno de Richmond",
      targetKeyword: "post holiday cleaning Richmond BC",
      targetZone: "all",
      expansionZones: ["Steveston", "Terra Nova"],
    },
    {
      month: 2,
      topicSeed: "Preparación para el Año Nuevo Lunar: limpieza profunda de primavera anticipada",
      targetKeyword: "Lunar New Year cleaning Richmond",
      targetZone: "City Centre",
      expansionZones: ["Bridgeport", "East Richmond"],
    },
    {
      month: 3,
      topicSeed: "Spring Cleaning: la guía definitiva para renovar tu hogar después del invierno",
      targetKeyword: "spring cleaning Richmond BC",
      targetZone: "all",
      expansionZones: ["Steveston", "Terra Nova", "Seafair", "Broadmoor", "Woodwards"],
    },
    {
      month: 4,
      topicSeed: "Moho y humedad: cómo la lluvia de primavera afecta los baños sin ventilación",
      targetKeyword: "mold prevention bathroom Richmond",
      targetZone: "all",
      expansionZones: ["Steveston", "Seafair"],
    },
    {
      month: 5,
      topicSeed: "Move-out cleaning: qué esperar y cómo dejar tu depósito intacto",
      targetKeyword: "move out cleaning Richmond BC",
      targetZone: "all",
      expansionZones: ["City Centre", "Bridgeport", "Terra Nova"],
    },
    {
      month: 6,
      topicSeed: "Airbnb turnover: cómo mantener 5 estrellas con cada huésped en temporada alta",
      targetKeyword: "Airbnb cleaning Richmond",
      targetZone: "Steveston",
      expansionZones: ["Seafair", "Terra Nova"],
    },
    {
      month: 7,
      topicSeed: "Limpieza de alfombras en verano: alérgenos, mascotas y arena de la playa",
      targetKeyword: "carpet cleaning Richmond summer",
      targetZone: "all",
      expansionZones: ["Steveston", "Terra Nova"],
    },
    {
      month: 8,
      topicSeed: "Vacation rental deep clean: el estándar que los huéspedes premium exigen",
      targetKeyword: "vacation rental cleaning Richmond",
      targetZone: "Steveston",
      expansionZones: ["Seafair"],
    },
    {
      month: 9,
      topicSeed: "Back to school, back to clean: rutinas de limpieza para familias ocupadas",
      targetKeyword: "family house cleaning Richmond BC",
      targetZone: "all",
      expansionZones: ["Broadmoor", "Woodwards", "McLennan"],
    },
    {
      month: 10,
      topicSeed: "Pre-Holiday Deep Clean: por qué octubre es el mes ideal para preparar tu casa",
      targetKeyword: "pre holiday deep cleaning Richmond",
      targetZone: "all",
      expansionZones: ["Terra Nova", "Broadmoor", "Woodwards"],
    },
    {
      month: 11,
      topicSeed: "Pisos de madera original: cómo proteger la inversión de tu hogar antes del invierno",
      targetKeyword: "hardwood floor care Richmond BC",
      targetZone: "all",
      expansionZones: ["Steveston", "Seafair"],
    },
    {
      month: 12,
      topicSeed: "Gift the gift of clean: por qué una gift card de limpieza es el mejor regalo estas fiestas",
      targetKeyword: "cleaning gift card Richmond Christmas",
      targetZone: "all",
      expansionZones: [],
    },
  ];
}

// ── Schema.org LocalBusiness Template ─────────────────────────────────────────

/** Datos que alimentan el schema JSON-LD de cada landing page. */
export interface LocalBusinessSchemaData {
  businessName: string;
  url: string;
  zone: RichmondZone | "all";
  servicesOffered: string[];
  averageRating: number;
  reviewCount: number;
  recentServicesInZone: number;
  teamLanguages: string[];
  /** Precio "desde" en centavos por hora (ej. 7000 = $70/hr). */
  priceRangeCents: number;
}

/**
 * Genera el objeto JSON-LD schema.org/LocalBusiness listo para inyectar en
 * el <head> de cada landing page dinámica. No es un string JSON todavía —
 * el caller lo serializa con JSON.stringify() y lo envuelve en
 * <script type="application/ld+json">.
 *
 * Incluye los campos que Google usa para el panel de conocimiento local:
 * name, url, areaServed, aggregateRating, priceRange, makesOffer.
 */
export function buildLocalBusinessSchema(data: LocalBusinessSchemaData): Record<string, unknown> {
  const priceDollars = (data.priceRangeCents / 100).toFixed(0);

  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: data.businessName,
    url: data.url,
    areaServed: {
      "@type": "City",
      name: "Richmond",
      containedInPlace: {
        "@type": "State",
        name: "British Columbia",
      },
    },
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: data.averageRating,
      reviewCount: data.reviewCount,
    },
    priceRange: `$${priceDollars}/hr`,
    makesOffer: data.servicesOffered.map((svc) => ({
      "@type": "Offer",
      itemOffered: {
        "@type": "Service",
        name: svc,
      },
    })),
    knowsLanguage: data.teamLanguages,
  };
}

// ── Landing Page Dinámica (Next.js ISR) ───────────────────────────────────────

/** Props que recibe la página ISR dinámica por zona. */
export interface ZoneLandingPageProps {
  zone: RichmondZone;
  zoneDisplayName: string;
  recentServicesCount: number;
  teamScoreAverage: number;
  teamLanguages: string[];
  badges: string[];
  schemaJsonLd: Record<string, unknown>;
  /** Posts de blog relacionados con esta zona (ya publicados). */
  relatedBlogPosts: Array<Pick<BlogPost, "id" | "title">>;
  /** Fecha de última regeneración ISR. */
  lastRegeneratedAt: string;
}

/**
 * Construye las props completas para una landing page de zona, incluyendo
 * el schema JSON-LD. El caller (getStaticProps de Next.js) llama a esta
 * función y pasa el resultado como props a la página.
 *
 * @param zone — zona postal de Richmond.
 * @param portfolioData — datos observables reales del portafolio en esa zona.
 * @param baseUrl — URL canónica del sitio (ej. "https://luluislandflagship.ca").
 */
export function buildZoneLandingPageProps(
  zone: RichmondZone,
  portfolioData: {
    recentServicesCount: number;
    teamScoreAverage: number;
    teamLanguages: string[];
    badges: string[];
    averageRating: number;
    reviewCount: number;
    priceRangeCents: number;
  },
  baseUrl: string,
  nowIso: string,
): ZoneLandingPageProps {
  const schema = buildLocalBusinessSchema({
    businessName: `Lulu Island Flagship — House Cleaning ${zone}`,
    url: `${baseUrl.replace(/\/$/, "")}/cleaning/${zone.toLowerCase().replace(/\s+/g, "-")}`,
    zone,
    servicesOffered: [
      "House Cleaning",
      "Deep Cleaning",
      "Move In/Out Cleaning",
      "Airbnb Turnover",
      "Carpet Cleaning",
    ],
    averageRating: portfolioData.averageRating,
    reviewCount: portfolioData.reviewCount,
    recentServicesInZone: portfolioData.recentServicesCount,
    teamLanguages: portfolioData.teamLanguages,
    priceRangeCents: portfolioData.priceRangeCents,
  });

  return {
    zone,
    zoneDisplayName: zone,
    recentServicesCount: portfolioData.recentServicesCount,
    teamScoreAverage: portfolioData.teamScoreAverage,
    teamLanguages: portfolioData.teamLanguages,
    badges: portfolioData.badges,
    schemaJsonLd: schema,
    relatedBlogPosts: [], // el caller lo puebla con posts reales de la DB
    lastRegeneratedAt: nowIso,
  };
}

// ── Integración con GBP Checklist ─────────────────────────────────────────────

/**
 * Mapea un slot editorial del calendario a un ítem del checklist GBP.
 * Cada vez que se publica contenido para una keyword/zonas, se registra
 * como actividad completada en el checklist de GBP (frecuencia semanal).
 */
export function editorialSlotToGbpChecklistItem(slot: EditorialSlot): GbpChecklistItem {
  return {
    itemKey: `seo_content_${slot.month}_${slot.targetZone}`,
    frequency: "weekly" as GbpFrequency,
    lastCompletedAt: null,
  };
}

/**
 * Evalúa si un borrador de blog generado a partir de un slot editorial
 * está listo para pasar a revisión. Envuelve evaluatePostForApproval de
 * blog-content.ts, agregando validación específica de SEO.
 */
export function evaluateSeoBlogPost(
  post: Pick<BlogPost, "content" | "sourceMetadata">,
  targetKeyword: string,
): PostEvaluationResult & { keywordIncluded: boolean; keywordDensityPercent: number } {
  const baseResult = evaluatePostForApproval(post);

  // Verificar inclusión de keyword objetivo
  const contentLower = post.content.toLowerCase();
  const keywordLower = targetKeyword.toLowerCase();
  const keywordIncluded = contentLower.includes(keywordLower);

  // Densidad aproximada de keyword (palabras de la keyword / palabras totales)
  const totalWords = post.content.split(/\s+/).filter(Boolean).length;
  const keywordWordCount = targetKeyword.split(/\s+/).length;
  const keywordOccurrences = totalWords > 0
    ? (contentLower.split(keywordLower).length - 1)
    : 0;
  const keywordDensityPercent = totalWords > 0
    ? Math.round(((keywordOccurrences * keywordWordCount) / totalWords) * 1000) / 10
    : 0;

  return {
    ...baseResult,
    keywordIncluded,
    keywordDensityPercent,
  };
}

// ── ROI Tracking del Pipeline SEO ─────────────────────────────────────────────

/** Métricas de performance del pipeline SEO completo. */
export interface SeoPipelineMetrics {
  /** Posts publicados en el período. */
  postsPublished: number;
  /** Landing pages de zona generadas. */
  landingPagesGenerated: number;
  /** Clics orgánicos atribuidos a landing pages de zona. */
  organicClicks: number;
  /** Cotizaciones iniciadas desde tráfico orgánico. */
  quotesFromOrganic: number;
  /** Órdenes concretadas desde tráfico orgánico. */
  ordersFromOrganic: number;
  /** Costo operativo del pipeline (horas de contenido + infraestructura ISR). */
  pipelineCostCents: number;
  /** Ingreso generado por órdenes de tráfico orgánico. */
  revenueFromOrganicCents: number;
}

/**
 * Calcula el ROI del pipeline SEO: (ingreso - costo) / costo.
 * ROI > 0 significa que el pipeline se paga solo.
 */
export function calculateSeoPipelineRoi(metrics: SeoPipelineMetrics): {
  roiPercent: number;
  costPerLeadCents: number;
  costPerOrderCents: number;
} {
  const costPerLeadCents =
    metrics.quotesFromOrganic > 0
      ? Math.round(metrics.pipelineCostCents / metrics.quotesFromOrganic)
      : 0;

  const costPerOrderCents =
    metrics.ordersFromOrganic > 0
      ? Math.round(metrics.pipelineCostCents / metrics.ordersFromOrganic)
      : 0;

  const roiPercent =
    metrics.pipelineCostCents > 0
      ? Math.round(
          ((metrics.revenueFromOrganicCents - metrics.pipelineCostCents) /
            metrics.pipelineCostCents) *
            100
        )
      : 0;

  return { roiPercent, costPerLeadCents, costPerOrderCents };
}

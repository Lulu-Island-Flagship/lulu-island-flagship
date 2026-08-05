/**
 * v8.3 E10 (H.3) — Programa de referidos amplificado.
 *
 * Extiende el programa base de referidos (referrals.ts) con:
 *   1. Link personalizado para compartir (URL corta con código del referente).
 *   2. Dashboard para el cliente: cuántos refirió, crédito acumulado, estado.
 *   3. Recompensa bilateral: $25 CAD para el referente Y $25 CAD para el
 *      referido (ajustado del default $30 de referrals.ts).
 *   4. Campaña de densidad vecinal: "Estamos en tu cuadra el martes, refiere
 *      a un vecino → ambos reciben nivel VIP inmediatamente."
 *
 * Conecta referrals.ts para la lógica base de códigos, elegibilidad y
 * anti-fraude. Este módulo agrega la capa de amplificación: dashboard,
 * links, campañas vecinales, y medición de ROI del programa amplificado.
 */

import {
  isEligibleForReferralCode,
  REFERRAL_VIP_MIN_SERVICES,
  REFERRAL_VIP_MIN_SCORE,
  // buildReferralCodeCandidate,
  normalizeReferralCode,
  // decideSameIpFraudFlag,
//   type _ReferralRedemptionDecision,
} from "./referrals";

// ── Recompensa bilateral amplificada ──────────────────────────────────────────

/** Recompensa bilateral del programa amplificado ($25 cada lado). */
export const AMPLIFIED_REFERRAL_CREDIT_CENTS = 2500;

/** Clientes con ≥ 3 referidos exitosos suben a Embajador con bono adicional. */
export const AMBASSADOR_THRESHOLD = 3;
export const AMBASSADOR_BONUS_CENTS = 1000; // $10 extra al llegar a 3 referidos

/** Recompensa de densidad vecinal: ambos reciben VIP inmediato. */
export const NEIGHBORHOOD_DENSITY_REWARD = "vip_immediate";

// ── Link personalizado ────────────────────────────────────────────────────────

/**
 * Construye el link personalizado de referido para compartir.
 * Formato: {baseUrl}/referral/{code}
 *
 * @param code — código de referido normalizado del referente.
 * @param baseUrl — URL base del sitio (sin trailing slash).
 */
export function buildReferralLink(code: string, baseUrl: string): string {
  const normalized = normalizeReferralCode(code);
  return `${baseUrl.replace(/\/$/, "")}/referral/${normalized}`;
}

/**
 * Genera un texto listo para compartir (WhatsApp, SMS, email) con el
 * link personalizado. Incluye el monto de la recompensa bilateral.
 */
export function buildReferralShareText(
  code: string,
  baseUrl: string,
  referrerName: string,
): string {
  const link = buildReferralLink(code, baseUrl);
  const amount = (AMPLIFIED_REFERRAL_CREDIT_CENTS / 100).toFixed(0);
  return `¡${referrerName} te recomienda Lulu Island Flagship! 🧹 Usa este link y ambos recibimos $${amount} de crédito: ${link}`;
}

// ── Dashboard del cliente ─────────────────────────────────────────────────────

/** Estado de un referido individual desde la perspectiva del referente. */
export interface ReferralStatus {
  /** Código usado por este referido. */
  code: string;
  /** Fecha en que el referido se registró (ISO). */
  referredAt: string;
  /** Si el referido ya completó su primer servicio (gatilla la recompensa). */
  hasCompletedFirstService: boolean;
  /** Crédito ganado por este referido (centavos). */
  earnedCreditCents: number;
  /** Si este referido vive en la misma zona postal que el referente. */
  isNeighbor: boolean;
}

/** Dashboard completo del cliente referente. */
export interface ReferralDashboard {
  /** Código personal del referente. */
  personalCode: string;
  /** Link para compartir. */
  shareLink: string;
  /** Total de personas referidas. */
  totalReferred: number;
  /** Referidos que ya completaron su primer servicio. */
  successfulReferrals: number;
  /** Crédito total acumulado (centavos). */
  totalCreditCents: number;
  /** Si ya es Embajador (≥ 3 referidos exitosos). */
  isAmbassador: boolean;
  /** Detalle de cada referido. */
  referrals: ReferralStatus[];
  /** Si hay campaña vecinal activa en su zona. */
  neighborhoodCampaignActive: boolean;
  /** Día de la semana en que el equipo pasa por su vecindario. */
  neighborhoodRouteDay?: string;
}

/**
 * Construye el dashboard de referidos para un cliente.
 * Función pura: todos los datos vienen del caller (DB).
 */
export function buildReferralDashboard(params: {
  personalCode: string;
  baseUrl: string;
  referrals: ReferralStatus[];
  neighborhoodCampaignActive: boolean;
  neighborhoodRouteDay?: string;
}): ReferralDashboard {
  const successfulReferrals = params.referrals.filter(
    (r) => r.hasCompletedFirstService,
  ).length;

  const totalCreditCents = params.referrals.reduce(
    (sum, r) => sum + r.earnedCreditCents,
    0,
  );

  const isAmbassador = successfulReferrals >= AMBASSADOR_THRESHOLD;

  return {
    personalCode: normalizeReferralCode(params.personalCode),
    shareLink: buildReferralLink(params.personalCode, params.baseUrl),
    totalReferred: params.referrals.length,
    successfulReferrals,
    totalCreditCents: isAmbassador
      ? totalCreditCents + AMBASSADOR_BONUS_CENTS
      : totalCreditCents,
    isAmbassador,
    referrals: params.referrals,
    neighborhoodCampaignActive: params.neighborhoodCampaignActive,
    neighborhoodRouteDay: params.neighborhoodRouteDay,
  };
}

// ── Elegibilidad VIP para programa amplificado ────────────────────────────────

/**
 * Verifica elegibilidad para el programa de referidos amplificado.
 * Mismos criterios base que referrals.ts: >5 servicios, score >80.
 */
export function isEligibleForAmplifiedReferral(
  servicesCount: number,
  score: number,
): { eligible: boolean; reason?: string } {
  if (!isEligibleForReferralCode(servicesCount, score)) {
    return {
      eligible: false,
      reason: `Requiere >${REFERRAL_VIP_MIN_SERVICES} servicios y score >${REFERRAL_VIP_MIN_SCORE}. Actual: ${servicesCount} servicios, ${score} score.`,
    };
  }
  return { eligible: true };
}

// ── Campaña de densidad vecinal ───────────────────────────────────────────────

/** Datos necesarios para lanzar una campaña de densidad vecinal. */
export interface NeighborhoodCampaign {
  /** Zona postal donde se activa la campaña. */
  zone: string;
  /** Día de la semana en que el equipo hace ruta en esa zona. */
  routeDay:
    | "monday"
    | "tuesday"
    | "wednesday"
    | "thursday"
    | "friday"
    | "saturday";
  /** Cantidad de clientes activos en la zona. */
  activeClientsInZone: number;
  /** Fecha de inicio de la campaña (ISO). */
  startsAt: string;
  /** Fecha de fin de la campaña (ISO). */
  endsAt: string;
  /** Cantidad de referidos vecinales generados hasta ahora. */
  neighborhoodReferralsGenerated: number;
}

/**
 * Mensaje de campaña vecinal personalizado para cada cliente elegible en la zona.
 * El mensaje varía según el día de ruta: "Estamos en tu cuadra el martes".
 */
export function buildNeighborhoodCampaignMessage(
  campaign: NeighborhoodCampaign,
  clientCode: string,
  baseUrl: string,
): string {
  const daySpanish: Record<string, string> = {
    monday: "lunes",
    tuesday: "martes",
    wednesday: "miércoles",
    thursday: "jueves",
    friday: "viernes",
    saturday: "sábado",
  };

  const day = daySpanish[campaign.routeDay] ?? campaign.routeDay;
  const link = buildReferralLink(clientCode, baseUrl);
  const amount = (AMPLIFIED_REFERRAL_CREDIT_CENTS / 100).toFixed(0);

  return `Estamos haciendo la ruta de tu vecindario (${campaign.zone}) los ${day}. Si refieres a un vecino de tu cuadra con este link, ambos reciben $${amount} de crédito Y nivel VIP inmediatamente: ${link}`;
}

/**
 * Determina si un cliente está en una zona con campaña vecinal activa.
 * @param clientZone — zona postal del cliente.
 * @param campaigns — campañas vecinales activas.
 * @param nowIso — momento actual para verificar vigencia.
 */
export function getActiveNeighborhoodCampaign(
  clientZone: string,
  campaigns: NeighborhoodCampaign[],
  nowIso: string,
): NeighborhoodCampaign | null {
  const now = new Date(nowIso).getTime();
  return (
    campaigns.find((c) => {
      const start = new Date(c.startsAt).getTime();
      const end = new Date(c.endsAt).getTime();
      return c.zone === clientZone && now >= start && now <= end;
    }) ?? null
  );
}

// ── ROI del programa amplificado ──────────────────────────────────────────────

/** Métricas del programa de referidos amplificado. */
export interface AmplifiedReferralMetrics {
  /** Clientes activos en el programa. */
  activeReferrers: number;
  /** Total de referidos generados. */
  totalReferralsGenerated: number;
  /** Referidos que se convirtieron en clientes (completaron primer servicio). */
  referralsConverted: number;
  /** Crédito total entregado (centavos). */
  totalCreditsIssuedCents: number;
  /** Ingreso generado por clientes referidos (centavos). */
  revenueFromReferralsCents: number;
  /** LTV promedio de un cliente referido (centavos). */
  avgLtvReferredClientCents: number;
}

/**
 * Calcula el ROI del programa amplificado de referidos.
 * ROI = (ingreso generado - crédito entregado) / crédito entregado.
 *
 * Un programa saludable tiene ROI > 300% (cada $1 de crédito genera $4+ de ingreso).
 */
export function calculateAmplifiedReferralRoi(
  metrics: AmplifiedReferralMetrics,
): {
  roiPercent: number;
  conversionRatePercent: number;
  costPerAcquisitionCents: number;
  isHealthy: boolean;
} {
  const conversionRatePercent =
    metrics.totalReferralsGenerated > 0
      ? Math.round(
          (metrics.referralsConverted / metrics.totalReferralsGenerated) * 1000
        ) / 10
      : 0;

  const costPerAcquisitionCents =
    metrics.referralsConverted > 0
      ? Math.round(metrics.totalCreditsIssuedCents / metrics.referralsConverted)
      : 0;

  const roiPercent =
    metrics.totalCreditsIssuedCents > 0
      ? Math.round(
          ((metrics.revenueFromReferralsCents - metrics.totalCreditsIssuedCents) /
            metrics.totalCreditsIssuedCents) *
            100
        )
      : 0;

  return {
    roiPercent,
    conversionRatePercent,
    costPerAcquisitionCents,
    isHealthy: roiPercent > 300,
  };
}

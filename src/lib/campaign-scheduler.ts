/**
 * v8.3 E10 (H.8) — Calendario de campañas estacionales automatizadas.
 *
 * Calendario pre-cargado para Richmond BC:
 *   Marzo      → Spring Cleaning
 *   Mayo       → Move-out (estudiantes UBC/SFU, renovaciones de contrato)
 *   Julio-Ago  → Vacation Rental (Airbnb temporada alta)
 *   Octubre    → Pre-Holiday Deep Clean
 *   Diciembre  → Gift Cards + Recovery post-fiestas
 *
 * Cada campaña requiere verificación de stock ANTES de activarse (usa
 * campaign-inventory-lock.ts). El spec es explícito: "Cada campaña
 * requiere verificación de stock antes de activarse" — no es opcional.
 *
 * Conexión con seasonal-campaigns/: este módulo define la estructura y
 * lógica de scheduling; los templates de cada campaña específica viven
 * en src/lib/seasonal-campaigns/ (cuando se cree ese directorio).
 */

import {
  type CampaignReference,
  type CampaignInventoryLockResult,
} from "./campaign-inventory-lock";

// ── Tipos de campaña ──────────────────────────────────────────────────────────

/** Estados de una campaña estacional. */
export type CampaignStatus =
  | "draft"
  | "pending_stock_check"
  | "stock_verified"
  | "active"
  | "paused"
  | "completed"
  | "blocked";

/** Una campaña estacional del calendario Richmond. */
export interface SeasonalCampaign {
  campaignId: string;
  name: string;
  description: string;
  /** Mes de inicio (1-12). */
  startMonth: number;
  /** Mes de fin (1-12, puede ser igual a startMonth). */
  endMonth: number;
  status: CampaignStatus;
  /** Zonas objetivo (vacío = todas las zonas). */
  targetZones: string[];
  /** Descuento ofrecido en la campaña (centavos). 0 = sin descuento. */
  discountCents: number;
  /** Cupones generados por la campaña. */
  couponsGenerated: number;
  /** Cupones canjeados (convirtieron en orden). */
  couponsRedeemed: number;
  /** Resultado de la verificación de stock más reciente. */
  lastStockCheck?: CampaignInventoryLockResult;
  /** Fecha de activación (ISO). */
  activatedAt?: string;
  /** Fecha de completación (ISO). */
  completedAt?: string;
}

// ── Calendario pre-cargado Richmond BC ────────────────────────────────────────

/**
 * Devuelve el calendario de campañas pre-cargado para Richmond BC.
 * Son 5 campañas anuales. El caller es responsable de crear los registros
 * en la base de datos con estos datos semilla.
 */
export function getRichmondCampaignCalendar(): Omit<
  SeasonalCampaign,
  "campaignId" | "status" | "lastStockCheck" | "activatedAt" | "completedAt"
>[] {
  return [
    {
      name: "Spring Cleaning 2026",
      description:
        "Limpieza profunda de primavera. Desinfección de pisos, ventanas, y zonas olvidadas en invierno. Targeting: casas unifamiliares, condos 55+.",
      startMonth: 3,
      endMonth: 3,
      targetZones: [],
      discountCents: 1500, // $15 off
      couponsGenerated: 0,
      couponsRedeemed: 0,
    },
    {
      name: "Move-Out Ready Mayo",
      description:
        "Move-in/move-out cleaning para estudiantes y renovaciones de contrato. Garantía de depósito: si el landlord no acepta la limpieza, re-servamos gratis.",
      startMonth: 5,
      endMonth: 5,
      targetZones: ["City Centre", "Bridgeport"],
      discountCents: 2000,
      couponsGenerated: 0,
      couponsRedeemed: 0,
    },
    {
      name: "Vacation Rental Turnover Verano",
      description:
        "Airbnb y VRBO turnover express. Limpieza + cambio de blancos en 2h. Disponible para anfitriones con back-to-back bookings.",
      startMonth: 7,
      endMonth: 8,
      targetZones: ["Steveston", "Seafair", "Terra Nova"],
      discountCents: 0, // Sin descuento — temporada alta
      couponsGenerated: 0,
      couponsRedeemed: 0,
    },
    {
      name: "Pre-Holiday Deep Clean Octubre",
      description:
        "Preparación para las fiestas: limpieza profunda de cocina, baños, y áreas de entretenimiento. Perfecto para anfitriones de Thanksgiving y Navidad.",
      startMonth: 10,
      endMonth: 10,
      targetZones: [],
      discountCents: 1000,
      couponsGenerated: 0,
      couponsRedeemed: 0,
    },
    {
      name: "Gift Cards + Recovery Diciembre",
      description:
        "Gift cards de limpieza para regalar + recovery post-fiestas. La gift card se activa en enero — ingresos de diciembre, trabajo de enero.",
      startMonth: 12,
      endMonth: 12,
      targetZones: [],
      discountCents: 0,
      couponsGenerated: 0,
      couponsRedeemed: 0,
    },
  ];
}

// ── Scheduling ────────────────────────────────────────────────────────────────

/**
 * Determina si una campaña debería estar activa según el mes actual.
 * Una campaña está "en temporada" si el mes actual cae dentro de su
 * ventana [startMonth, endMonth].
 *
 * @param campaign — la campaña a evaluar.
 * @param currentMonth — mes actual (1-12).
 */
export function isCampaignInSeason(
  campaign: Pick<SeasonalCampaign, "startMonth" | "endMonth">,
  currentMonth: number,
): boolean {
  if (campaign.endMonth >= campaign.startMonth) {
    // Ventana dentro del mismo año (ej. Marzo a Marzo, Julio a Agosto)
    return currentMonth >= campaign.startMonth && currentMonth <= campaign.endMonth;
  }
  // Ventana que cruza el año (ej. Diciembre a Enero — no usado actualmente pero soportado)
  return currentMonth >= campaign.startMonth || currentMonth <= campaign.endMonth;
}

/**
 * Encuentra las campañas que deberían estar activas este mes.
 * Solo devuelve campañas que están en temporada Y no están bloqueadas.
 */
export function getActiveSeasonalCampaigns(
  campaigns: SeasonalCampaign[],
  currentMonth: number,
): SeasonalCampaign[] {
  return campaigns.filter(
    (c) =>
      isCampaignInSeason(c, currentMonth) &&
      c.status !== "blocked" &&
      c.status !== "completed",
  );
}

/**
 * Determina cuál es la siguiente campaña en el calendario.
 * Útil para el dashboard de marketing: "Próxima campaña: Spring Cleaning en 45 días".
 */
export function getNextUpcomingCampaign(
  campaigns: SeasonalCampaign[],
  currentMonth: number,
): SeasonalCampaign | null {
  // Campañas futuras cuyo startMonth > currentMonth
  const upcoming = campaigns
    .filter((c) => c.startMonth > currentMonth)
    .sort((a, b) => a.startMonth - b.startMonth);

  return upcoming[0] ?? null;
}

// ── Verificación de stock ─────────────────────────────────────────────────────

/**
 * Prepara la referencia de campaña para pasarla al inventory lock.
 * El campaign-scheduler no DUPLICA la lógica de verificación — solo
 * construye el input que campaign-inventory-lock.ts necesita.
 */
export function toCampaignReference(
  campaign: SeasonalCampaign,
  fechaPropuesta: string,
): CampaignReference {
  return {
    campaignId: campaign.campaignId,
    campaignName: campaign.name,
    fechaActivacionPropuesta: fechaPropuesta,
  };
}

/**
 * Evalúa si una campaña puede activarse dados los resultados del inventory
 * lock. No ejecuta la verificación — solo interpreta el resultado.
 */
export function evaluateStockCheckResult(
  campaign: SeasonalCampaign,
  result: CampaignInventoryLockResult,
): {
  canActivate: boolean;
  newStatus: CampaignStatus;
  reason: string;
} {
  if (result.aprobada) {
    return {
      canActivate: true,
      newStatus: "stock_verified",
      reason: result.razon,
    };
  }

  return {
    canActivate: false,
    newStatus: "blocked",
    reason: result.razon,
  };
}

// ── Métricas de campaña ───────────────────────────────────────────────────────

/** Métricas de performance de una campaña. */
export interface CampaignPerformance {
  campaignId: string;
  campaignName: string;
  couponsGenerated: number;
  couponsRedeemed: number;
  redemptionRatePercent: number;
  revenueGeneratedCents: number;
  discountCostCents: number;
  netRevenueCents: number;
}

/**
 * Calcula la performance de una campaña.
 */
export function calculateCampaignPerformance(
  campaign: SeasonalCampaign,
  revenueGeneratedCents: number,
): CampaignPerformance {
  const redemptionRatePercent =
    campaign.couponsGenerated > 0
      ? Math.round(
          (campaign.couponsRedeemed / campaign.couponsGenerated) * 1000
        ) / 10
      : 0;

  const discountCostCents = campaign.couponsRedeemed * campaign.discountCents;

  return {
    campaignId: campaign.campaignId,
    campaignName: campaign.name,
    couponsGenerated: campaign.couponsGenerated,
    couponsRedeemed: campaign.couponsRedeemed,
    redemptionRatePercent,
    revenueGeneratedCents,
    discountCostCents,
    netRevenueCents: revenueGeneratedCents - discountCostCents,
  };
}

// ── Cupones ───────────────────────────────────────────────────────────────────

/** Un cupón generado por una campaña estacional. */
export interface CampaignCoupon {
  couponId: string;
  campaignId: string;
  code: string;
  discountCents: number;
  clientId?: string;
  status: "available" | "claimed" | "redeemed" | "expired";
  expiresAt: string;
  createdAt: string;
  redeemedAt?: string;
  redeemedOrderId?: string;
}

/**
 * Genera un código de cupón legible para una campaña.
 * Formato: {PREFIJO_CAMPAÑA}-{RANDOM_SUFFIX}
 * Ej: SPRING-A3F9
 */
export function generateCouponCode(
  campaignName: string,
  randomSuffix: string,
): string {
  const prefix = campaignName
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
    .slice(0, 6);

  const suffix = randomSuffix.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 4);

  return `${prefix}-${suffix}`;
}

/**
 * Determina si un cupón es canjeable ahora.
 */
export function isCouponRedeemable(
  coupon: CampaignCoupon,
  nowIso: string,
): { redeemable: boolean; reason?: string } {
  if (coupon.status === "redeemed") {
    return { redeemable: false, reason: "Cupón ya canjeado." };
  }
  if (coupon.status === "expired") {
    return { redeemable: false, reason: "Cupón expirado." };
  }

  const now = new Date(nowIso).getTime();
  const expires = new Date(coupon.expiresAt).getTime();

  if (now > expires) {
    return { redeemable: false, reason: "Cupón expirado (fecha de vencimiento pasada)." };
  }

  return { redeemable: true };
}

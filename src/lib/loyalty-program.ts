/**
 * v8.3 E.1.6 — Programa de Lealtad Visible (Retención y Crecimiento).
 *
 * El cliente ve su progreso de lealtad en tiempo real: cuántos servicios le
 * faltan para el siguiente nivel, qué beneficios tiene activos, su panel de
 * referidos, y recompensas por densidad vecinal.
 *
 * NIVELES DE LEALTAD (spec E.1.6):
 *   - 3 servicios sin disputa → "Cliente Premium"
 *   - 5 servicios → descuento 5% automático
 *   - 10 servicios → nivel VIP con beneficios premium
 *
 * PANEL DE REFERIDOS (spec E.1.6 + E5.13):
 *   - "Invitaste a 2 amigos → $50 de crédito"
 *   - Código de referido único
 *   - Anti-fraude delegado a referrals.ts
 *
 * RECOMPENSA POR DENSIDAD VECINAL (spec E.1.6):
 *   - "Estamos haciendo la ruta de su vecindario los martes. Si refiere a un
 *     vecino de su cuadra, ambos reciben nivel VIP inmediatamente."
 *
 * Consume:
 *   - referrals.ts: isEligibleForReferralCode, REFERRAL_CREDIT_CENTS,
 *     REFERRAL_VIP_MIN_SERVICES, buildReferralCodeCandidate, decideReferralRedemptionAttempt
 *   - client-scoring.ts: deriveClientType, isRecurring (contexto, nunca se expone el score)
 *
 * INVARIANTES DUROS:
 *   - NUNCA expone el score interno del cliente (computeClientScore).
 *   - NUNCA expone nombres individuales de empleados.
 *   - Los beneficios son visibles y accionables por el cliente.
 *   - El descuento del 5% se calcula en el cotizador (no aquí); aquí solo se
 *     determina si el cliente es elegible.
 *
 * Lógica pura: sin I/O. El route handler consulta Supabase para los conteos
 * de servicios/disputas/referidos y pasa los datos a estas funciones.
 */

import { z } from "zod";

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTES
// ═══════════════════════════════════════════════════════════════════════════

/** Umbrales de nivel de lealtad. */
export const LOYALTY_TIERS = {
  premium: {
    minServices: 3,
    name: "Premium",
    badgeIcon: "⭐",
    description: "Cliente Premium — 3+ servicios sin disputa.",
    benefits: ["Prioridad en agenda", "Insignia Premium visible", "Nota de Cuidado extendida (280 chars)"],
  },
  gold: {
    minServices: 5,
    name: "Gold",
    badgeIcon: "🌟",
    description: "Cliente Gold — 5+ servicios sin disputa.",
    discountPercent: 5,
    benefits: [
      "5% descuento automático en todos los servicios",
      "Prioridad de slot garantizada (antes que no-recurrentes)",
      "Nota de Cuidado extendida (280 chars)",
      "Acceso anticipado a nuevas zonas de servicio",
    ],
  },
  vip: {
    minServices: 10,
    name: "VIP",
    badgeIcon: "👑",
    description: "Cliente VIP — 10+ servicios sin disputa.",
    discountPercent: 5,
    benefits: [
      "5% descuento automático en todos los servicios",
      "Prioridad de slot garantizada + agenda preferente",
      "Nota de Cuidado extendida (280 chars)",
      "Coordinador dedicado para consultas",
      "Regalo de cumpleaños (kit de productos Lulu)",
      "Acceso a servicios experimentales (nuevas zonas, horarios extendidos)",
    ],
  },
} as const;

export type LoyaltyTier = keyof typeof LOYALTY_TIERS | "base";

/** Crédito por referido exitoso (en dólares canadienses). */
export const REFERRAL_CREDIT_CAD = 30;

/** Crédito por referido vecinal (en dólares canadienses). */
export const NEIGHBORHOOD_REFERRAL_CREDIT_CAD = 50;

/** Máximo de referidos mostrados en el panel del cliente. */
export const MAX_VISIBLE_REFERRALS = 10;

// ═══════════════════════════════════════════════════════════════════════════
// ZOD SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

export const LoyaltyStatusSchema = z.object({
  /** Nivel actual del cliente (base, premium, gold, vip). */
  currentTier: z.enum(["base", "premium", "gold", "vip"]),
  /** Servicios completados sin disputa. */
  servicesWithoutDispute: z.number().int().min(0),
  /** Servicios totales completados (incluyendo los que tuvieron disputa). */
  totalServicesCompleted: z.number().int().min(0),
  /** Siguiente nivel (null si ya es VIP). */
  nextTier: z.enum(["premium", "gold", "vip"]).nullable(),
  /** Servicios que faltan para el siguiente nivel. */
  servicesToNextTier: z.number().int().min(0).nullable(),
  /** ¿Tiene descuento activo? (gold/vip). */
  hasActiveDiscount: z.boolean(),
  /** Porcentaje de descuento activo (0 si no tiene). */
  discountPercent: z.number().int().min(0).max(100),
  /** Beneficios activos del nivel actual. */
  activeBenefits: z.array(z.string()),
  /** Badge visible (emoji + nombre del nivel). */
  badgeLabel: z.string(),
  /** ¿Es VIP? (acceso directo). */
  isVip: z.boolean(),
});

export const ReferralPanelSchema = z.object({
  /** Código de referido del cliente (null si no es elegible aún). */
  referralCode: z.string().nullable(),
  /** ¿El cliente es elegible para tener código de referido? (VIP >5 servicios). */
  isEligibleForReferralCode: z.boolean(),
  /** Total de referidos exitosos (canjeados). */
  totalReferrals: z.number().int().min(0),
  /** Crédito total acumulado por referidos (CAD). */
  totalReferralCreditCAD: z.number().min(0),
  /** Crédito disponible (no usado aún). */
  availableCreditCAD: z.number().min(0),
  /** Lista de referidos recientes (máx 10). */
  recentReferrals: z.array(
    z.object({
      /** Fecha del referido (ISO date). */
      dateISO: z.string(),
      /** Estado del referido. */
      status: z.enum(["pending", "completed", "credited", "expired"]),
      /** Crédito ganado (CAD). */
      creditCAD: z.number().min(0),
      /** ¿Fue un referido vecinal? */
      isNeighborhood: z.boolean(),
    })
  ).max(MAX_VISIBLE_REFERRALS),
  /** Total de referidos vecinales. */
  neighborhoodReferralCount: z.number().int().min(0),
});

export const LoyaltyDashboardSchema = z.object({
  loyalty: LoyaltyStatusSchema,
  referrals: ReferralPanelSchema,
  /** ¿El vecindario del cliente está activo en la ruta actual? */
  neighborhoodRouteActive: z.boolean(),
  /** Día de la semana en que pasa la ruta por el vecindario (null si no está activo). */
  neighborhoodRouteDay: z.string().nullable(),
  /** Mensaje de recompensa vecinal. */
  neighborhoodRewardMessage: z.string().nullable(),
});

// ═══════════════════════════════════════════════════════════════════════════
// TIPOS DERIVADOS
// ═══════════════════════════════════════════════════════════════════════════

export type LoyaltyStatus = z.infer<typeof LoyaltyStatusSchema>;
export type ReferralPanel = z.infer<typeof ReferralPanelSchema>;
export type LoyaltyDashboard = z.infer<typeof LoyaltyDashboardSchema>;

export interface LoyaltyCalculationInput {
  /** Servicios completados sin disputa (histórico). */
  servicesWithoutDispute: number;
  /** Servicios totales completados. */
  totalServicesCompleted: number;
}

export interface ReferralPanelInput {
  /** Código de referido actual del cliente. */
  referralCode: string | null;
  /** ¿Es elegible para código? (>5 servicios, score >80 — evaluado por referrals.ts). */
  isEligibleForReferralCode: boolean;
  /** Conteo de referidos exitosos. */
  totalReferrals: number;
  /** Crédito total acumulado. */
  totalReferralCreditCAD: number;
  /** Crédito disponible. */
  availableCreditCAD: number;
  /** Referidos recientes para el panel. */
  recentReferrals: {
    dateISO: string;
    status: "pending" | "completed" | "credited" | "expired";
    creditCAD: number;
    isNeighborhood: boolean;
  }[];
  /** Conteo de referidos vecinales. */
  neighborhoodReferralCount: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// CÁLCULO DE NIVEL DE LEALTAD
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Determina el nivel de lealtad del cliente basado en servicios sin disputa.
 * Regla del plan:
 *   - 0-2  → base
 *   - 3-4  → premium
 *   - 5-9  → gold (con 5% descuento)
 *   - 10+  → vip (con 5% descuento + beneficios premium)
 */
export function determineLoyaltyTier(servicesWithoutDispute: number): LoyaltyTier {
  if (servicesWithoutDispute >= LOYALTY_TIERS.vip.minServices) return "vip";
  if (servicesWithoutDispute >= LOYALTY_TIERS.gold.minServices) return "gold";
  if (servicesWithoutDispute >= LOYALTY_TIERS.premium.minServices) return "premium";
  return "base";
}

/**
 * Calcula cuántos servicios le faltan al cliente para el siguiente nivel.
 *
 * @returns [siguiente nivel, servicios faltantes] o [null, null] si ya es VIP.
 */
export function calculateNextTierProgress(
  servicesWithoutDispute: number
): { nextTier: LoyaltyTier | null; servicesNeeded: number | null } {
  if (servicesWithoutDispute >= LOYALTY_TIERS.vip.minServices) {
    return { nextTier: null, servicesNeeded: null };
  }
  if (servicesWithoutDispute >= LOYALTY_TIERS.gold.minServices) {
    return {
      nextTier: "vip",
      servicesNeeded: LOYALTY_TIERS.vip.minServices - servicesWithoutDispute,
    };
  }
  if (servicesWithoutDispute >= LOYALTY_TIERS.premium.minServices) {
    return {
      nextTier: "gold",
      servicesNeeded: LOYALTY_TIERS.gold.minServices - servicesWithoutDispute,
    };
  }
  return {
    nextTier: "premium",
    servicesNeeded: LOYALTY_TIERS.premium.minServices - servicesWithoutDispute,
  };
}

/**
 * Construye el estado de lealtad completo para mostrar al cliente.
 */
export function buildLoyaltyStatus(input: LoyaltyCalculationInput): LoyaltyStatus {
  const currentTier = determineLoyaltyTier(input.servicesWithoutDispute);
  const { nextTier, servicesNeeded } = calculateNextTierProgress(input.servicesWithoutDispute);

  let hasActiveDiscount = false;
  let discountPercent = 0;
  let activeBenefits: string[] = [];
  let badgeLabel = "";

  switch (currentTier) {
    case "vip": {
      const tier = LOYALTY_TIERS.vip;
      hasActiveDiscount = true;
      discountPercent = tier.discountPercent;
      activeBenefits = [...tier.benefits];
      badgeLabel = `${tier.badgeIcon} Cliente ${tier.name}`;
      break;
    }
    case "gold": {
      const tier = LOYALTY_TIERS.gold;
      hasActiveDiscount = true;
      discountPercent = tier.discountPercent;
      activeBenefits = [...tier.benefits];
      badgeLabel = `${tier.badgeIcon} Cliente ${tier.name}`;
      break;
    }
    case "premium": {
      const tier = LOYALTY_TIERS.premium;
      activeBenefits = [...tier.benefits];
      badgeLabel = `${tier.badgeIcon} Cliente ${tier.name}`;
      break;
    }
    case "base":
      activeBenefits = ["Acceso a cotizador en línea", "Garantía Lulu en todos los servicios"];
      badgeLabel = "🏠 Cliente";
      break;
  }

  return {
    currentTier,
    servicesWithoutDispute: input.servicesWithoutDispute,
    totalServicesCompleted: input.totalServicesCompleted,
    nextTier: nextTier as LoyaltyStatus["nextTier"],
    servicesToNextTier: servicesNeeded,
    hasActiveDiscount,
    discountPercent,
    activeBenefits,
    badgeLabel,
    isVip: currentTier === "vip",
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PANEL DE REFERIDOS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Construye el panel de referidos para mostrar al cliente.
 */
export function buildReferralPanel(input: ReferralPanelInput): ReferralPanel {
  return {
    referralCode: input.referralCode,
    isEligibleForReferralCode: input.isEligibleForReferralCode,
    totalReferrals: input.totalReferrals,
    totalReferralCreditCAD: input.totalReferralCreditCAD,
    availableCreditCAD: input.availableCreditCAD,
    recentReferrals: input.recentReferrals.slice(0, MAX_VISIBLE_REFERRALS),
    neighborhoodReferralCount: input.neighborhoodReferralCount,
  };
}

/**
 * Genera el mensaje del panel de referidos:
 * "Invitaste a X amigos → $Y de crédito."
 */
export function buildReferralSummaryMessage(panel: ReferralPanel): string {
  if (panel.totalReferrals === 0) {
    if (!panel.isEligibleForReferralCode) {
      const needed = 6; // >5 servicios para código (REFERRAL_VIP_MIN_SERVICES = 5, necesita >5 = 6)
      return `Completa ${needed} servicios sin disputa para desbloquear tu código de referido y empezar a ganar crédito.`;
    }
    return "Comparte tu código de referido y gana $30 de crédito por cada amigo que reserve.";
  }

  return `Invitaste a ${panel.totalReferrals} amigo${panel.totalReferrals !== 1 ? "s" : ""} → ` +
    `$${panel.totalReferralCreditCAD} de crédito acumulado. ` +
    `Disponible: $${panel.availableCreditCAD}.`;
}

// ═══════════════════════════════════════════════════════════════════════════
// RECOMPENSA POR DENSIDAD VECINAL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Construye el mensaje de recompensa vecinal basado en si la ruta del
 * vecindario está activa y qué día pasa.
 *
 * Spec: "Estamos haciendo la ruta de su vecindario los martes. Si refiere
 * a un vecino de su cuadra, ambos reciben nivel VIP inmediatamente."
 */
export function buildNeighborhoodRewardMessage(
  routeActive: boolean,
  routeDay: string | null
): string | null {
  if (!routeActive || !routeDay) return null;

  const days: Record<string, string> = {
    monday: "lunes",
    tuesday: "martes",
    wednesday: "miércoles",
    thursday: "jueves",
    friday: "viernes",
    saturday: "sábado",
  };

  const dayLabel = days[routeDay.toLowerCase()] ?? routeDay;

  return `Estamos haciendo la ruta de su vecindario los ${dayLabel}. ` +
    `Si refiere a un vecino de su cuadra, ambos reciben nivel VIP inmediatamente ` +
    `($${NEIGHBORHOOD_REFERRAL_CREDIT_CAD} de crédito cada uno).`;
}

/**
 * Determina si un referido es "vecinal" (mismo código postal o zona).
 * El route handler debe pasar esta información; aquí solo se valida.
 */
export function isNeighborhoodReferral(
  referrerPostalCode: string,
  referredPostalCode: string
): boolean {
  // Misma cuadra = mismos primeros 4 caracteres del postal code (ej. V7E 3J)
  // En Canadá, los primeros 3 caracteres definen el FSA (Forward Sortation Area)
  // que es ~1-2 km² — suficientemente granular para "vecindario".
  const referrerFSA = referrerPostalCode.replace(/\s/g, "").slice(0, 3).toUpperCase();
  const referredFSA = referredPostalCode.replace(/\s/g, "").slice(0, 3).toUpperCase();
  return referrerFSA === referredFSA && referrerFSA.length === 3;
}

// ═══════════════════════════════════════════════════════════════════════════
// DASHBOARD COMPLETO
// ═══════════════════════════════════════════════════════════════════════════

export interface LoyaltyDashboardInput {
  loyalty: LoyaltyCalculationInput;
  referrals: ReferralPanelInput;
  neighborhoodRouteActive: boolean;
  neighborhoodRouteDay: string | null;
}

/**
 * Construye el dashboard completo de lealtad que el cliente ve en /account/loyalty.
 */
export function buildLoyaltyDashboard(input: LoyaltyDashboardInput): LoyaltyDashboard {
  const loyalty = buildLoyaltyStatus(input.loyalty);
  const referrals = buildReferralPanel(input.referrals);
  const neighborhoodRewardMessage = buildNeighborhoodRewardMessage(
    input.neighborhoodRouteActive,
    input.neighborhoodRouteDay
  );

  return {
    loyalty,
    referrals,
    neighborhoodRouteActive: input.neighborhoodRouteActive,
    neighborhoodRouteDay: input.neighborhoodRouteDay,
    neighborhoodRewardMessage,
  };
}

/**
 * Genera el mensaje de progreso hacia el siguiente nivel.
 * Ejemplo: "Te faltan 2 servicios sin disputa para ser Cliente Gold (5% descuento)."
 */
export function buildTierProgressMessage(status: LoyaltyStatus): string | null {
  if (!status.nextTier || status.servicesToNextTier === null) return null;

  const tierInfo = LOYALTY_TIERS[status.nextTier];
  const discountNote = "discountPercent" in tierInfo && tierInfo.discountPercent
    ? ` (${tierInfo.discountPercent}% descuento)`
    : "";

  return `Te ${status.servicesToNextTier === 1 ? "falta" : "faltan"} ${status.servicesToNextTier} ` +
    `servicio${status.servicesToNextTier !== 1 ? "s" : ""} sin disputa para ser ` +
    `Cliente ${tierInfo.name}${discountNote}.`;
}

/**
 * Valida el dashboard de lealtad contra el schema Zod.
 */
export function validateLoyaltyDashboard(
  raw: unknown
): { valid: true; data: LoyaltyDashboard } | { valid: false; error: string } {
  const result = LoyaltyDashboardSchema.safeParse(raw);
  if (!result.success) {
    return { valid: false, error: result.error.issues.map((i) => i.message).join("; ") };
  }
  return { valid: true, data: result.data };
}

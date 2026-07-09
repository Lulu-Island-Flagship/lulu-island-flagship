/**
 * v8.3 E9 (D.9.11) — Programa de regalos por retención.
 *
 * Residencial 12+ meses activos = 4-5% del valor del primer año, en tiers
 * de producto (no efectivo). Entrega tras 60-90 días de permanencia activa
 * adicional. Se descuenta de CAC/LTV; si el LTV no lo cubre, requiere
 * aprobación manual.
 *
 * Property managers: NUNCA regalo personal oculto (riesgo penal s.426 — Code
 * Criminal de Canadá, comisiones secretas a agentes). Solo dos vías válidas:
 *   (a) beneficio transparente al edificio (ej: sesión de limpieza para
 *       áreas comunes), o
 *   (b) comisión de partnership declarada, con T4A.
 * Esta regla es dura: la función ni siquiera acepta un tercer valor.
 */

export interface GiftTier {
  tier: "tier1" | "tier2" | "tier3";
  minValue: number;
  maxValue: number | null;
  productExamples: string;
  giftMinDollars: number;
  giftMaxDollars: number;
}

export const GIFT_TIERS: GiftTier[] = [
  { tier: "tier1", minValue: 2000, maxValue: 4000, productExamples: "cafetera/parlante", giftMinDollars: 75, giftMaxDollars: 100 },
  { tier: "tier2", minValue: 4000, maxValue: 8000, productExamples: "robot/tablet", giftMinDollars: 150, giftMaxDollars: 225 },
  { tier: "tier3", minValue: 8000, maxValue: null, productExamples: "laptop/TV/consola", giftMinDollars: 300, giftMaxDollars: 500 },
];

export const MIN_MONTHS_ACTIVE_FOR_GIFT = 12;
export const DELIVERY_DELAY_MIN_DAYS = 60;
export const DELIVERY_DELAY_MAX_DAYS = 90;
export const GIFT_PERCENT_MIN = 0.04;
export const GIFT_PERCENT_MAX = 0.05;

export interface ResidentialGiftEligibility {
  eligible: boolean;
  reason: string;
  tier?: GiftTier;
  suggestedGiftDollars?: number;
  requiresManualApproval?: boolean;
}

/**
 * ¿Este cliente residencial califica para el regalo de retención?
 * @param monthsActive meses activos consecutivos (servicios continuos)
 * @param firstYearValue valor facturado en el primer año
 * @param ltv LTV estimado del cliente (para chequear que el regalo no supere el margen)
 */
export function evaluateResidentialGiftEligibility(
  monthsActive: number,
  firstYearValue: number,
  ltv: number
): ResidentialGiftEligibility {
  if (monthsActive < MIN_MONTHS_ACTIVE_FOR_GIFT) {
    return { eligible: false, reason: `Requiere ${MIN_MONTHS_ACTIVE_FOR_GIFT}+ meses activos (lleva ${monthsActive}).` };
  }

  const tier = GIFT_TIERS.find(
    (t) => firstYearValue >= t.minValue && (t.maxValue === null || firstYearValue < t.maxValue)
  );

  if (!tier) {
    return { eligible: false, reason: `Valor del primer año ($${firstYearValue}) no alcanza el tier mínimo ($${GIFT_TIERS[0].minValue}).` };
  }

  const suggestedGiftDollars = Math.round(
    Math.min(Math.max(firstYearValue * GIFT_PERCENT_MIN, tier.giftMinDollars), tier.giftMaxDollars)
  );

  const requiresManualApproval = suggestedGiftDollars > ltv;

  return {
    eligible: true,
    reason: `Elegible: ${monthsActive} meses activos, tier ${tier.tier} (${tier.productExamples}).`,
    tier,
    suggestedGiftDollars,
    requiresManualApproval,
  };
}

// ------------------------------------------------------------
// Property managers: solo dos vías válidas, nunca regalo oculto.
// ------------------------------------------------------------

export type PropertyManagerBenefitType = "transparent_building_benefit" | "declared_partnership_commission";

export interface PropertyManagerBenefit {
  type: PropertyManagerBenefitType;
  description: string;
  requiresT4A: boolean;
}

/**
 * Construye el registro de beneficio a un property manager. Es IMPOSIBLE
 * pasar un tercer tipo: TypeScript solo acepta los dos valores del union,
 * y la función además valida en runtime por si el valor viene de un JSON
 * externo (API) que no pasó por el type-check.
 */
export function createPropertyManagerBenefit(
  type: PropertyManagerBenefitType,
  description: string
): PropertyManagerBenefit {
  if (type !== "transparent_building_benefit" && type !== "declared_partnership_commission") {
    throw new Error(
      "Tipo de beneficio inválido. Solo se permite 'transparent_building_benefit' o 'declared_partnership_commission' — nunca un regalo personal oculto (riesgo penal s.426)."
    );
  }
  return { type, description, requiresT4A: true };
}

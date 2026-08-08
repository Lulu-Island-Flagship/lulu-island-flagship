import { applyPricingRules, type PricingRule, type RuleContext } from "../rules";
import {
  type ServiceType,
  TARIFA_OBJETIVO_HORA,
  DEFAULT_LABOR_HOURLY,
  MARGIN_FLOOR_PERCENT,
  HHE_TABLE,
  getHHEForRange,
  getZoneSurcharge,
  type AddonZoneOption,
} from "./catalog";
import { computeTaxBreakdown } from "./taxes";

// ─── E6.6: Factura impresa opcional ────────────────────────────────
// Del plan: "Factura impresa opcional (+$2 correo; B2B siempre impresa+digital)".
// B2B/government ya reciben ambos formatos por defecto sin recargo (ver
// trigger trg_b2b_printed_invoice_default, migración 201) -- el recargo
// solo aplica a B2C que lo solicita explícitamente (cliente en el cotizador
// web, o coordinador en su nombre en una reserva telefónica).
export const PRINTED_INVOICE_SURCHARGE = 2;

export function computePrintedInvoiceCharge(
  printedInvoiceRequested: boolean,
  accountType: "b2c" | "b2b" | "government"
): number {
  if (accountType !== "b2c") return 0; // B2B/Gov: incluido, sin recargo
  return printedInvoiceRequested ? PRINTED_INVOICE_SURCHARGE : 0;
}

export function getBasePriceWithRate(
  serviceType: ServiceType,
  squareFeet: number,
  targetHourlyRate: number,
  hheTable: Record<ServiceType, number[]> = HHE_TABLE
): number {
  const hhe = getHHEForRange(serviceType, squareFeet, hheTable);
  return Math.round(hhe * targetHourlyRate);
}

/** Wrapper con fallback $70 para compatibilidad con código cliente/legacy. */
export function getBasePrice(serviceType: ServiceType, squareFeet: number): number {
  return getBasePriceWithRate(serviceType, squareFeet, TARIFA_OBJETIVO_HORA);
}

// Multiplicadores de carga orgánica
// Reglas exactas del spec v8.2:
//   sin mascotas + ≤2 residentes: 0.90×
//   1 mascota pelo corto + 2-3 residentes: 1.00×
//   1-2 mascotas pelo largo + 3-4 residentes: 1.15×
//   3+ mascotas o 5+ residentes: 1.30×
//
// Los casos no cubiertos explícitamente por el spec se redondean al
// multiplicador inmediatamente inferior (conservador para el cliente).
export function getOrganicMultiplier(
  petsCount: number,
  petsType: string,
  residents: number
): number {
  const hasPets = petsCount > 0;
  // Fix (auditoría 2026-08-06): petsType podía ser null/undefined desde
  // un payload malformado o un formulario incompleto, y .toLowerCase()
  // tiraba TypeError que tumbaba todo el pipeline de cotización.
  const safePetsType = (petsType ?? "").toLowerCase();
  const hasLongHairPets =
    hasPets &&
    (safePetsType.includes("largo") ||
      safePetsType.includes("long") ||
      safePetsType.includes("multiple"));

  // Caso extremo: 3+ mascotas o 5+ residentes
  if (petsCount >= 3 || residents >= 5) return 1.3;

  // Sin mascotas
  if (!hasPets) {
    return residents <= 2 ? 0.9 : 1.0;
  }

  // Con mascotas de pelo largo
  if (hasLongHairPets) {
    if (residents >= 3 && residents <= 4) return 1.15;
    // 1-2 mascotas pelo largo con 1-2 residentes: no está explícito; usamos 1.00
    return 1.0;
  }

  // Con mascotas de pelo corto
  if (residents >= 2 && residents <= 3) return 1.0;
  // 1 mascota pelo corto + 1 residente o +4 residentes: no explícito; usamos 1.00
  return 1.0;
}

// Factor de densidad — cómo interactúan los sq ft con la carga orgánica y recencia.
// Espacios más grandes con más suciedad orgánica y más tiempo sin limpiar requieren
// más esfuerzo del que captura cada multiplicador por separado.
export function getDensityMultiplier(
  squareFeet: number,
  organicMultiplier: number,
  recencyMultiplier: number
): number {
  // Sin penalización para espacios pequeños
  if (squareFeet <= 500) return 1.0;

  // El factor base crece con los sq ft a partir de 500
  const sqftFactor = Math.min(1.0, (squareFeet - 500) / 4500);
  const combinedLoad = ((organicMultiplier - 1) + (recencyMultiplier - 1)) / 2;
  return 1.0 + sqftFactor * Math.max(0, combinedLoad) * 0.5;
}

// Factor de recencia (interno — NUNCA visible al cliente)
export function getRecencyMultiplier(daysSinceCleaning: number): number {
  if (daysSinceCleaning < 30) return 0.85;
  if (daysSinceCleaning <= 60) return 1.0;
  if (daysSinceCleaning <= 90) return 1.15;
  return 1.3;
}

/**
 * Suma zone_time_hours × tarifa objetivo de las zonas add-on seleccionadas
 * por el cliente. Ignora selecciones que no existen en `available` (defensa
 * ante manipulación del payload — el servidor SIEMPRE recalcula desde la
 * lista real de zonas add-on activas, nunca confía en un monto enviado por
 * el cliente).
 */
export function calculateAddonZonesCharge(
  available: AddonZoneOption[],
  selectedZones: string[],
  targetHourlyRate: number = TARIFA_OBJETIVO_HORA
): number {
  const selectedSet = new Set(selectedZones);
  const totalHours = available
    .filter((z) => selectedSet.has(z.zone))
    .reduce((sum, z) => sum + z.timeHours, 0);
  return Math.round(totalHours * targetHourlyRate);
}

// Hold de seguridad (T-72h)
// Hold = MAX(fórmula_base, 40% del total proyectado)
// Fórmula base: (Tarifa_hora × 3h × N_referencia) × 1.10
export function calculateHoldWithRate(
  serviceType: ServiceType,
  squareFeet: number,
  totalProjected: number,
  targetHourlyRate: number
): number {
  const nReference = getNReference(serviceType, squareFeet);
  const formulaBase = Math.round(targetHourlyRate * 3 * nReference * 1.1);
  const fortyPercent = Math.round(totalProjected * 0.4);
  return Math.max(formulaBase, fortyPercent);
}

/** Wrapper que acepta tarifa opcional; fallback $70 para código cliente/legacy. */
export function calculateHold(
  serviceType: ServiceType,
  squareFeet: number,
  totalProjected: number,
  targetHourlyRate: number = TARIFA_OBJETIVO_HORA
): number {
  return calculateHoldWithRate(serviceType, squareFeet, totalProjected, targetHourlyRate);
}

export function getNReference(serviceType: ServiceType, squareFeet: number): number {
  // N de referencia para el Hold según tipo + ft².
  // Usa N_min de la tabla getNRange (líneas 444-468): el número mínimo de
  // personas requeridas para ese tipo + rango de tamaño.
  // Fix (auditoría 2026-08-06): antes solo cubría 4 combinaciones;
  // ahora cubre las 8 explícitamente usando N_min del spec.
  if (serviceType === "regular") {
    if (squareFeet <= 700) return 1;
    if (squareFeet <= 1500) return 2;
    if (squareFeet <= 2500) return 2;
    if (squareFeet <= 3500) return 3;
    return 3;
  }
  if (serviceType === "deep") {
    if (squareFeet <= 700) return 2;
    if (squareFeet <= 1500) return 2;
    if (squareFeet <= 2500) return 2;
    if (squareFeet <= 3500) return 3;
    return 4;
  }
  if (serviceType === "move_in_out") {
    if (squareFeet <= 1500) return 2;
    if (squareFeet <= 2500) return 3;
    if (squareFeet <= 3500) return 3;
    return 4;
  }
  // post_construction
  if (squareFeet <= 1500) return 3;
  if (squareFeet <= 2500) return 3;
  if (squareFeet <= 3500) return 3;
  return 4;
}

export function estimateLaborCost(
  serviceType: ServiceType,
  squareFeet: number,
  hheTable: Record<ServiceType, number[]> = HHE_TABLE
): number {
  const hhe = getHHEForRange(serviceType, squareFeet, hheTable);
  return Math.round(hhe * DEFAULT_LABOR_HOURLY);
}

export function calculateMarginContribution(subtotal: number, laborCost: number): number {
  if (subtotal <= 0) return 0;
  return (subtotal - laborCost) / subtotal;
}

export function marginIsBelowFloor(subtotal: number, laborCost: number): boolean {
  return calculateMarginContribution(subtotal, laborCost) < MARGIN_FLOOR_PERCENT;
}

// Cálculo completo de precio
export interface PriceBreakdown {
  basePrice: number;
  organicMultiplier: number;
  organicAdjustment: number;
  recencyMultiplier: number;
  recencyAdjustment: number;
  densityMultiplier: number;
  densityAdjustment: number;
  zoneSurcharge: number;
  logisticsSurcharge: number;
  addonZonesCharge: number;
  ruleAdjustment: number;
  appliedRules: import("../rules").AppliedRule[];
  subtotal: number;
  gst: number;
  pst: number;
  total: number;
  holdAmount: number;
  estimatedLaborCost: number;
  estimatedMarginContribution: number;
  adminReviewRequired: boolean;
  adminReviewReason?: string;
  /** Fix (auditoría externa, hallazgo #1): propagado desde el motor de reglas
   *  real (src/lib/rules.ts applyPricingRules) -- antes calculatePrice nunca
   *  lo invocaba y estos campos quedaban hardcodeados. */
  blocked: boolean;
  blockReason?: string;
  flagged: boolean;
  flagReason?: string;
}

function deriveDefaultOrganicLoad(
  petsCount: number,
  petsType: string,
  residents: number
): RuleContext["organicLoad"] {
  if (petsCount >= 3 || residents >= 5) return "high";
  const hasLongHair =
    petsType.toLowerCase().includes("long") ||
    petsType.toLowerCase().includes("largo") ||
    petsType.toLowerCase().includes("multiple");
  if (hasLongHair || residents >= 3) return "medium";
  return "low";
}

export function calculatePrice(
  serviceType: ServiceType,
  squareFeet: number,
  petsCount: number,
  petsType: string,
  residents: number,
  daysSinceCleaning: number,
  zoneName: string,
  dayOfWeek?: number, // 0=Dom, 6=Sab
  isPreferredDay?: boolean,
  targetHourlyRate: number = TARIFA_OBJETIVO_HORA,
  hheTable: Record<ServiceType, number[]> = HHE_TABLE,
  addonZonesCharge: number = 0,
  // Fix (auditoría externa, hallazgo #1 -- CRÍTICO): el motor de reglas
  // headless (src/lib/rules.ts) existía pero calculatePrice nunca lo
  // invocaba, así que `ruleAdjustment`/`appliedRules` salían siempre
  // hardcodeados a 0/[]. Ambos parámetros son opcionales (default: sin
  // reglas activas ni contexto extra) para no romper llamadas existentes que
  // todavía no pasen reglas -- pero ahora, si se pasan, el motor real se
  // aplica y su resultado es el que efectivamente afecta subtotal/total.
  rules: PricingRule[] = [],
  ruleContextExtra: Partial<RuleContext> = {}
): PriceBreakdown {
  // Validar squareFeet para evitar precios absurdos
  const MAX_SQUARE_FEET = 10000;
  const validatedSquareFeet = Math.min(Math.max(300, squareFeet), MAX_SQUARE_FEET);

  const basePrice = getBasePriceWithRate(serviceType, validatedSquareFeet, targetHourlyRate, hheTable);
  const organicMultiplier = getOrganicMultiplier(petsCount, petsType, residents);
  const recencyMultiplier = getRecencyMultiplier(daysSinceCleaning);
  const zoneSurcharge = getZoneSurcharge(zoneName);

  // Recargo logístico por día no preferencial (ej. fin de semana)
  let logisticsSurcharge = 0;
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    logisticsSurcharge = 25;
  }
  if (isPreferredDay === false) {
    logisticsSurcharge = 25;
  }

  const densityMultiplier = getDensityMultiplier(validatedSquareFeet, organicMultiplier, recencyMultiplier);
  const organicAdjustment = Math.round(basePrice * (organicMultiplier - 1));
  const recencyAdjustment = Math.round(basePrice * (recencyMultiplier - 1));
  const densityAdjustment = Math.round(basePrice * (densityMultiplier - 1));

  // v8.3 E4 (D.7): recargo de zonas add-on (ej. Garaje) editables por el
  // admin. El monto SIEMPRE llega ya recalculado por el servidor contra la
  // lista real de zonas activas (calculateAddonZonesCharge) — nunca se
  // confía en un número que venga del cliente.
  const safeAddonZonesCharge = Math.max(0, Math.round(addonZonesCharge));

  const subtotalBeforeRules =
    basePrice + organicAdjustment + recencyAdjustment + densityAdjustment + zoneSurcharge + logisticsSurcharge + safeAddonZonesCharge;

  const estimatedLaborCost = estimateLaborCost(serviceType, validatedSquareFeet, hheTable);
  const estimatedMarginContribution = calculateMarginContribution(subtotalBeforeRules, estimatedLaborCost);
  const marginAdminReviewRequired = marginIsBelowFloor(subtotalBeforeRules, estimatedLaborCost);

  // Construir el RuleContext con los datos disponibles en esta función. Los
  // campos que calculatePrice no conoce (score de cliente, tipo de cuenta,
  // demanda de zona, antelación de reserva, etc.) los provee el caller vía
  // ruleContextExtra -- si no los provee, se usan defaults conservadores
  // (equivalentes a "sin reglas activas" para condiciones que dependan de
  // ellos, ya que un contexto por defecto no debería disparar reglas
  // agresivas segmentadas).
  const ruleContext: RuleContext = {
    zone: zoneName,
    dayOfWeek: dayOfWeek ?? 1,
    isPreferredDay: isPreferredDay ?? true,
    serviceType,
    serviceSubtype: ruleContextExtra.serviceSubtype ?? "",
    squareFeet: validatedSquareFeet,
    clientScore: ruleContextExtra.clientScore ?? 50,
    servicesCount: ruleContextExtra.servicesCount ?? 0,
    disputesLostCount: ruleContextExtra.disputesLostCount ?? 0,
    accountType: ruleContextExtra.accountType ?? "b2c",
    clientType: ruleContextExtra.clientType ?? "new",
    zoneDemand: ruleContextExtra.zoneDemand ?? 50,
    organicLoad: ruleContextExtra.organicLoad ?? deriveDefaultOrganicLoad(petsCount, petsType, residents),
    daysSinceCleaning,
    advanceNoticeDays: ruleContextExtra.advanceNoticeDays ?? 0,
  };

  const ruleResult = applyPricingRules(rules, ruleContext, basePrice, subtotalBeforeRules);

  // Fix (auditoría externa, hallazgo #2): toda la aritmética de
  // subtotal/GST/PST/total se hace en centavos enteros dentro de
  // computeTaxBreakdown, incluyendo el ajuste real de reglas -- ya no se
  // pierde precisión redondeando el subtotal a dólares enteros antes de
  // sumarle el ajuste.
  const taxBreakdown = computeTaxBreakdown(subtotalBeforeRules + ruleResult.adjustment);

  const holdAmount = calculateHoldWithRate(serviceType, validatedSquareFeet, taxBreakdown.total, targetHourlyRate);

  const adminReviewRequired = marginAdminReviewRequired || ruleResult.flagged;
  const adminReviewReasons: string[] = [];
  if (marginAdminReviewRequired) {
    adminReviewReasons.push(
      `Margen de contribución estimado ${(estimatedMarginContribution * 100).toFixed(1)}% está por debajo del piso del ${(MARGIN_FLOOR_PERCENT * 100).toFixed(0)}%`
    );
  }
  if (ruleResult.flagged && ruleResult.flagReason) {
    adminReviewReasons.push(ruleResult.flagReason);
  }

  return {
    basePrice,
    organicMultiplier,
    organicAdjustment,
    recencyMultiplier,
    recencyAdjustment,
    densityMultiplier,
    densityAdjustment,
    zoneSurcharge,
    logisticsSurcharge,
    addonZonesCharge: safeAddonZonesCharge,
    ruleAdjustment: ruleResult.adjustment,
    appliedRules: ruleResult.appliedRules,
    subtotal: taxBreakdown.subtotal,
    gst: taxBreakdown.gst,
    pst: taxBreakdown.pst,
    total: taxBreakdown.total,
    holdAmount,
    estimatedLaborCost,
    estimatedMarginContribution,
    adminReviewRequired,
    adminReviewReason: adminReviewReasons.length > 0 ? adminReviewReasons.join("; ") : undefined,
    blocked: ruleResult.blocked,
    blockReason: ruleResult.blockReason,
    flagged: ruleResult.flagged,
    flagReason: ruleResult.flagReason,
  };
}

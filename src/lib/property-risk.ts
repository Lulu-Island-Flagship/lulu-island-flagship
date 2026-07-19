/**
 * v8.3 E7 — Pre-evaluación de riesgo por dirección (spec sección E7, punto 7).
 * Función pura: cuenta flags acumulativos y determina el nivel de revisión
 * requerido ANTES de despachar el servicio. Visible a admin y líder, nunca
 * al cliente (regla explícita del spec).
 *
 * Umbrales: 0-2 flags = estándar / 3-4 = auditor obligatorio / 5+ = inspección previa.
 */

export type RiskFlagType =
  | "steep_stairs" // escaleras empinadas -> +PPE +15 min
  | "aggressive_dog" // perro agresivo -> dueño presente
  | "mold_over_1sqm" // moho >1m² -> NO es servicio Lulu (bloqueo duro, no solo flag)
  | "confined_space" // espacio confinado -> 2 personas + check-in 15 min
  | "defective_lockbox"; // lockbox defectuoso -> ver flujo de llaves

export type RiskTier = "standard" | "auditor_required" | "pre_inspection_required";

export interface RiskAssessment {
  flagCount: number;
  tier: RiskTier;
  /** true si la dirección queda excluida del servicio por completo (moho >1m²) */
  hardBlocked: boolean;
  requiresPPE: boolean;
  requiresOwnerPresent: boolean;
  requiresTwoPersonTeam: boolean;
  requiresCheckInAt15Min: boolean;
  requiresKeyEscalation: boolean;
  notes: string[];
}

export function evaluatePropertyRisk(flags: RiskFlagType[]): RiskAssessment {
  const unique = Array.from(new Set(flags));
  const flagCount = unique.length;
  const notes: string[] = [];

  const hardBlocked = unique.includes("mold_over_1sqm");
  if (hardBlocked) {
    notes.push(
      "Moho >1m² detectado: esta dirección NO es servicio Lulu — referir a especialista en remediación."
    );
  }

  const tier: RiskTier =
    flagCount >= 5 ? "pre_inspection_required" : flagCount >= 3 ? "auditor_required" : "standard";

  if (tier === "auditor_required") {
    notes.push("3-4 flags acumulados: auditor de campo obligatorio para este servicio.");
  } else if (tier === "pre_inspection_required") {
    notes.push("5+ flags acumulados: requiere inspección previa antes de aceptar la reserva.");
  }

  const requiresPPE = unique.includes("steep_stairs");
  if (requiresPPE) notes.push("Escaleras empinadas: equipo requiere PPE adicional y +15 min de bloque.");

  const requiresOwnerPresent = unique.includes("aggressive_dog");
  if (requiresOwnerPresent) notes.push("Perro agresivo reportado: dueño debe estar presente durante el servicio.");

  const requiresTwoPersonTeam = unique.includes("confined_space");
  const requiresCheckInAt15Min = unique.includes("confined_space");
  if (requiresTwoPersonTeam) {
    notes.push("Espacio confinado: mínimo 2 personas y check-in obligatorio a los 15 min.");
  }

  const requiresKeyEscalation = unique.includes("defective_lockbox");
  if (requiresKeyEscalation) {
    notes.push("Lockbox reportado defectuoso: seguir protocolo de escalación de llaves (15 min).");
  }

  return {
    flagCount,
    tier,
    hardBlocked,
    requiresPPE,
    requiresOwnerPresent,
    requiresTwoPersonTeam,
    requiresCheckInAt15Min,
    requiresKeyEscalation,
    notes,
  };
}

/**
 * v8.3 E7 — Consecuencia de la evaluación de riesgo AL RESERVAR (conecta
 * evaluatePropertyRisk / property_risk_assessments al flujo de
 * cotización/reserva, que hasta ahora nunca las leía).
 *
 * Umbrales (spec E7 punto 7 + criterio de aceptación):
 *  - hardBlocked (moho >1m²): la dirección NO es servicio Lulu. Bloqueo
 *    total, sin importar el tier.
 *  - pre_inspection_required (5+ flags): "exige inspección previa antes de
 *    permitir reserva" — se reutiliza el mecanismo existente de
 *    admin_review_required (igual que B2B / piso de margen), que ya bloquea
 *    la confirmación automática en /api/stripe/confirm.
 *  - auditor_required (3-4 flags): NO bloquea la reserva — "auditor
 *    obligatorio" es un requisito de dotación en el servicio (debe asistir
 *    un auditor de campo), no una condición previa a aceptar la reserva.
 *    Se propaga como `requiresFieldAuditor` para que despacho/admin lo vean.
 *  - standard (0-2 flags) o sin evaluación registrada: sin consecuencia.
 */
export interface BookingRiskConsequence {
  allowed: boolean;
  blockReason?: string;
  requiresAdminReview: boolean;
  adminReviewReason?: string;
  requiresFieldAuditor: boolean;
}

export function evaluateBookingRiskConsequence(
  assessment: Pick<RiskAssessment, "tier" | "hardBlocked"> | null
): BookingRiskConsequence {
  if (!assessment) {
    return { allowed: true, requiresAdminReview: false, requiresFieldAuditor: false };
  }

  if (assessment.hardBlocked) {
    return {
      allowed: false,
      blockReason:
        "Esta dirección tiene moho >1m² registrado: no es un servicio Lulu. Referir a especialista en remediación (v8.3 E7).",
      requiresAdminReview: false,
      requiresFieldAuditor: false,
    };
  }

  if (assessment.tier === "pre_inspection_required") {
    return {
      allowed: true,
      requiresAdminReview: true,
      adminReviewReason:
        "Dirección con 5+ flags de riesgo acumulados: requiere inspección previa antes de confirmar la reserva (v8.3 E7).",
      requiresFieldAuditor: false,
    };
  }

  if (assessment.tier === "auditor_required") {
    return {
      allowed: true,
      requiresAdminReview: false,
      requiresFieldAuditor: true,
    };
  }

  return { allowed: true, requiresAdminReview: false, requiresFieldAuditor: false };
}

/** Normaliza una dirección para hacer match contra client_properties (trim + espacios + minúsculas). */
export function normalizeAddressForMatch(address: string): string {
  return address.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * v8.3 E7 fix de auditoría — flag consultable de multas vehiculares impagas
 * (vehicle_fines, migración 186). No es un RiskFlagType de dirección/
 * propiedad (eso es exclusivamente sobre la PROPIEDAD del cliente) -- es una
 * señal de riesgo de FLOTA aparte, expuesta en este mismo módulo temático de
 * E7 por conveniencia del consumidor (admin), sin mezclarse con
 * evaluatePropertyRisk. Función pura: el llamador (endpoint admin) es quien
 * cuenta las multas impagas por vehículo desde vehicle_fines y le pasa el
 * conteo/total aquí.
 */
export interface VehicleFineRiskInput {
  unpaidFinesCount: number;
  unpaidFinesTotalCents: number;
}

export interface VehicleFineRiskFlag {
  hasOutstandingFines: boolean;
  /** 3+ multas impagas acumuladas en el mismo vehículo: amerita revisión admin. */
  requiresAdminReview: boolean;
}

export const VEHICLE_FINE_ADMIN_REVIEW_THRESHOLD_COUNT = 3;

export function evaluateVehicleFineRisk(input: VehicleFineRiskInput): VehicleFineRiskFlag {
  return {
    hasOutstandingFines: input.unpaidFinesCount > 0,
    requiresAdminReview: input.unpaidFinesCount >= VEHICLE_FINE_ADMIN_REVIEW_THRESHOLD_COUNT,
  };
}

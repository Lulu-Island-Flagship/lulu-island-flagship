/**
 * v8.3 E.1.4 — Garantía Explícita Visible (Confianza en Todo el Flujo).
 *
 * La garantía Lulu es visible en tres momentos clave del customer journey:
 *   1. CHECKOUT: badge de confianza antes de pagar.
 *      "Garantía Lulu: Si algo no coincide con la foto de cierre, re-servamos gratis en 24h."
 *   2. POST-SERVICIO: recordatorio en la cuenta del cliente.
 *      "Su pago se procesa hoy 7 PM. ¿Algo no coincide? Repórtelo — revisamos contra la evidencia."
 *   3. BOTÓN "Reportar issue" en /account/services/[orderId] con flujo guiado.
 *
 * INVARIANTE: la garantía SIEMPRE se resuelve contra evidencia fotográfica de
 * cierre (invariante B.2.2), nunca contra reloj ni contra la palabra del cliente.
 * Si no hay foto de cierre de la zona reclamada, se resuelve automáticamente a
 * favor del cliente — la empresa asume la carga de la prueba.
 *
 * Consume:
 *   - warranty-claim-validation.ts: isWarrantyClaimEligible, WARRANTY_CLAIM_WINDOW_DAYS,
 *     validateWarrantyClaimInput
 *   - warranty-dispute-resolution.ts: evaluateWarrantyDisputeResolution,
 *     WarrantyDisputeResolutionResult
 *
 * Lógica pura: sin I/O. Las llamadas a Supabase y el envío de notificaciones
 * viven en el route handler correspondiente.
 */

import { z } from "zod";
import {
  isWarrantyClaimEligible,
  WARRANTY_CLAIM_WINDOW_DAYS,
} from "./warranty-claim-validation";
import { evaluateWarrantyDisputeResolution } from "./warranty-dispute-resolution";
// import type { ZoneClosureEvidence, ClientClaimInput } from "./warranty-dispute-resolution";

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTES
// ═══════════════════════════════════════════════════════════════════════════

/** Horario de procesamiento de pagos (spec: 7 PM). */
export const PAYMENT_PROCESSING_HOUR = 19;

/** Plazo de re-servicio en horas (spec: 24h). */
export const RE_SERVICE_WINDOW_HOURS = 24;

/** Texto del badge de garantía en checkout. */
export const WARRANTY_CHECKOUT_BADGE_TEXT =
  "Garantía Lulu: Si algo no coincide con la foto de cierre, re-servamos gratis en 24h.";

/** Máximo de fotos que el cliente puede adjuntar como evidencia en un reporte. */
export const MAX_CLIENT_EVIDENCE_PHOTOS = 6;

// ═══════════════════════════════════════════════════════════════════════════
// ZOD SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

export const WarrantyStatusSchema = z.object({
  /** ¿La orden está dentro de la ventana de reclamo? */
  isClaimWindowOpen: z.boolean(),
  /** Fecha límite para reclamar (ISO date). */
  claimDeadlineISO: z.string().nullable(),
  /** Días restantes para reclamar (0 si la ventana ya cerró). */
  daysRemaining: z.number().int().min(0),
  /** ¿El cliente ya reportó algún issue en esta orden? */
  hasActiveClaim: z.boolean(),
  /** Número de claims activos en esta orden. */
  activeClaimCount: z.number().int().min(0),
  /** Estados de los claims existentes, si los hay. */
  claimStatuses: z.array(
    z.object({
      claimZone: z.string(),
      status: z.enum(["pending_review", "auto_resolved_favor_client", "auto_resolved_favor_team", "resolved", "requires_human_review"]),
      resolved: z.boolean(),
    })
  ),
});

export const ReportIssueInputSchema = z.object({
  orderId: z.string().uuid(),
  claimZone: z.string().min(1),
  reason: z.string().min(3).max(200),
  description: z.string().max(2000).optional(),
  photoUrls: z.array(z.string()).max(MAX_CLIENT_EVIDENCE_PHOTOS).optional(),
});

// ═══════════════════════════════════════════════════════════════════════════
// TIPOS DERIVADOS
// ═══════════════════════════════════════════════════════════════════════════

export type WarrantyStatus = z.infer<typeof WarrantyStatusSchema>;
export type ReportIssueInput = z.infer<typeof ReportIssueInputSchema>;

// ═══════════════════════════════════════════════════════════════════════════
// VISIBILIDAD EN CHECKOUT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Genera el texto del badge de garantía que se muestra en el checkout.
 * Es estático para consistencia de marca — el cliente siempre ve la misma
 * promesa de garantía antes de pagar.
 */
export function getCheckoutWarrantyBadge(): string {
  return WARRANTY_CHECKOUT_BADGE_TEXT;
}

/**
 * Genera el bloque de confianza completo para el checkout, que incluye
 * el badge de garantía más detalles de respaldo.
 */
export interface CheckoutWarrantyBlock {
  badgeText: string;
  details: string[];
  trustIcon: string;
}

export function buildCheckoutWarrantyBlock(): CheckoutWarrantyBlock {
  return {
    badgeText: WARRANTY_CHECKOUT_BADGE_TEXT,
    details: [
      `Reclamos válidos hasta ${WARRANTY_CLAIM_WINDOW_DAYS} días después del servicio.`,
      "Resolución contra evidencia fotográfica de cierre — sin letra chica.",
      "Re-servicio gratuito en 24h si la evidencia nos da la razón al cliente.",
    ],
    trustIcon: "🛡️",
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// VISIBILIDAD POST-SERVICIO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Genera el mensaje post-servicio que el cliente ve en su cuenta.
 * Incluye la hora de procesamiento del pago y el llamado a la acción
 * de "reportar si algo no coincide".
 *
 * @param paymentProcessingHourISO Hora local en que se procesa el pago (default 7 PM).
 */
export function buildPostServiceWarrantyMessage(
  paymentProcessingHourISO?: string
): string {
  const hour = paymentProcessingHourISO ?? `${PAYMENT_PROCESSING_HOUR}:00`;
  return `Su pago se procesa hoy a las ${hour}. ¿Algo no coincide con la foto de cierre? ` +
    `Repórtelo — revisamos contra la evidencia. Tiene ${WARRANTY_CLAIM_WINDOW_DAYS} días.`;
}

// ═══════════════════════════════════════════════════════════════════════════
// ESTADO DE GARANTÍA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calcula el estado de la garantía para una orden específica.
 * Responde: ¿puede el cliente reportar un issue? ¿Ya reportó algo?
 * ¿Cuántos días le quedan?
 *
 * @param orderServiceDate Fecha del servicio (ISO date).
 * @param nowISO Fecha actual para calcular la ventana.
 * @param existingClaims Claims activos/resueltos que ya tiene esta orden (el
 *   route handler los obtiene de warranty_claims).
 */
export function computeWarrantyStatus(
  orderServiceDate: string,
  nowISO: string,
  existingClaims: { claimZone: string; status: string; resolved: boolean }[]
): WarrantyStatus {
  const isClaimWindowOpen = isWarrantyClaimEligible(orderServiceDate, new Date(nowISO));

  // Calcular deadline
  const deadline = new Date(
    new Date(`${orderServiceDate}T00:00:00Z`).getTime() +
      WARRANTY_CLAIM_WINDOW_DAYS * 24 * 60 * 60 * 1000
  );
  const claimDeadlineISO = deadline.toISOString().slice(0, 10);

  // Días restantes
  const nowMs = new Date(nowISO).getTime();
  const deadlineMs = deadline.getTime();
  const daysRemaining = Math.max(
    0,
    Math.ceil((deadlineMs - nowMs) / (1000 * 60 * 60 * 24))
  );

  const activeClaims = existingClaims.filter((c) => !c.resolved);

  return {
    isClaimWindowOpen,
    claimDeadlineISO,
    daysRemaining,
    hasActiveClaim: activeClaims.length > 0,
    activeClaimCount: activeClaims.length,
    claimStatuses: existingClaims.map((c) => ({
      claimZone: c.claimZone,
      status: c.status as WarrantyStatus["claimStatuses"][number]["status"],
      resolved: c.resolved,
    })),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// FLUJO "REPORTAR ISSUE"
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Valida el input del formulario "Reportar Issue" usando los schemas de
 * warranty-claim-validation.ts (validación de forma) más reglas adicionales
 * de este módulo.
 */
export function validateReportIssueInput(
  input: unknown
): { valid: true; data: ReportIssueInput } | { valid: false; error: string } {
  const result = ReportIssueInputSchema.safeParse(input);
  if (!result.success) {
    return { valid: false, error: result.error.issues.map((i) => i.message).join("; ") };
  }
  return { valid: true, data: result.data };
}

/**
 * Determina si un reporte de issue puede ser creado para esta orden.
 * Combina:
 *   - ¿La ventana de reclamo sigue abierta?
 *   - ¿Ya hay un reclamo activo para esta misma zona? (no duplicados)
 *   - ¿La zona reclamada existe en el checklist de la orden?
 *
 * @returns Decisión con razón legible si es rechazado.
 */
export function canCreateClaim(
  orderServiceDate: string,
  nowISO: string,
  claimZone: string,
  existingClaimZones: string[],
  validOrderZones: string[]
): { allowed: boolean; reason?: string } {
  // 1. ¿Ventana abierta?
  if (!isWarrantyClaimEligible(orderServiceDate, new Date(nowISO))) {
    const deadline = new Date(
      new Date(`${orderServiceDate}T00:00:00Z`).getTime() +
        WARRANTY_CLAIM_WINDOW_DAYS * 24 * 60 * 60 * 1000
    );
    return {
      allowed: false,
      reason: `La ventana de reclamo cerró el ${deadline.toISOString().slice(0, 10)} ` +
        `(${WARRANTY_CLAIM_WINDOW_DAYS} días post-servicio).`,
    };
  }

  // 2. ¿Ya reclamó esta zona?
  if (existingClaimZones.includes(claimZone)) {
    return {
      allowed: false,
      reason: `Ya existe un reclamo activo para la zona "${claimZone}". ` +
        "No se permiten reclamos duplicados para la misma zona.",
    };
  }

  // 3. ¿La zona existe en la orden?
  if (!validOrderZones.includes(claimZone)) {
    return {
      allowed: false,
      reason: `La zona "${claimZone}" no pertenece al checklist de esta orden. ` +
        `Zonas válidas: ${validOrderZones.join(", ")}.`,
    };
  }

  return { allowed: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// RESOLUCIÓN PRELIMINAR (para mostrar al cliente tras reportar)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Después de que el cliente reporta un issue, el sistema evalúa la disputa
 * contra la evidencia de cierre y devuelve un resultado preliminar que el
 * cliente puede ver inmediatamente.
 *
 * Esta es una capa de UI sobre evaluateWarrantyDisputeResolution() que
 * traduce los resultados técnicos a mensajes legibles para el cliente.
 */
export interface WarrantyReportResult {
  /** ¿Se resolvió automáticamente o requiere revisión humana? */
  autoResolved: boolean;
  /** Mensaje para mostrar al cliente inmediatamente después de reportar. */
  clientMessage: string;
  /** Acción sugerida visible al cliente. */
  suggestedClientAction: string;
  /** ¿El cliente debe esperar? (true si requiere revisión humana). */
  requiresWait: boolean;
  /** Tiempo estimado de resolución (legible). */
  estimatedResolutionTime: string;
}

export function buildWarrantyReportResult(
  disputeResult: ReturnType<typeof evaluateWarrantyDisputeResolution>
): WarrantyReportResult {
  switch (disputeResult.outcome) {
    case "auto_favor_client_missing_closure_evidence":
      return {
        autoResolved: true,
        clientMessage:
          "Hemos revisado su reporte. No encontramos foto de cierre para esta zona, " +
          "así que la garantía se activa automáticamente a su favor.",
        suggestedClientAction:
          "Un coordinador le contactará en las próximas 2 horas para agendar el re-servicio sin costo.",
        requiresWait: true,
        estimatedResolutionTime: "2 horas",
      };

    case "auto_favor_team_unsubstantiated_claim":
      return {
        autoResolved: true,
        clientMessage:
          "Revisamos su reporte contra la foto de cierre de esta zona. " +
          "La evidencia muestra que la zona fue completada según el checklist. " +
          "Puede ver la foto de cierre en su cuenta.",
        suggestedClientAction:
          "Si considera que la foto no refleja el estado real, puede adjuntar " +
          "sus propias fotos como evidencia adicional para revisión humana.",
        requiresWait: false,
        estimatedResolutionTime: "Inmediata",
      };

    case "requires_human_review_contradictory_evidence":
      return {
        autoResolved: false,
        clientMessage:
          "Recibimos su reporte con evidencia fotográfica. Un coordinador " +
          "comparará sus fotos con las fotos de cierre del equipo y le responderá " +
          "con una decisión.",
        suggestedClientAction:
          "No necesita hacer nada más por ahora. Le notificaremos por email " +
          "cuando haya una resolución.",
        requiresWait: true,
        estimatedResolutionTime: "24 horas",
      };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILIDADES DE PRESENTACIÓN
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Genera un resumen del estado de garantía para mostrar en la lista de
 * servicios de /account. Una línea por orden.
 *
 * Ejemplos:
 *   - "🛡️ Garantía activa — 5 días restantes"
 *   - "⚠ Reclamo en revisión — Zona: Cocina"
 *   - "✓ Garantía cerrada — sin reclamos"
 */
export function buildWarrantySummaryLine(status: WarrantyStatus): string {
  if (status.hasActiveClaim) {
    const zones = status.claimStatuses
      .filter((c) => !c.resolved)
      .map((c) => c.claimZone);
    const pendingReview = status.claimStatuses.some(
      (c) => c.status === "requires_human_review"
    );
    const prefix = pendingReview ? "⏳" : "⚠";
    return `${prefix} Reclamo en revisión — Zona${zones.length > 1 ? "s" : ""}: ${zones.join(", ")}`;
  }

  if (!status.isClaimWindowOpen) {
    const resolved = status.claimStatuses.filter((c) => c.resolved);
    if (resolved.length > 0) {
      return "✓ Garantía cerrada — reclamo resuelto";
    }
    return "✓ Garantía cerrada — sin reclamos";
  }

  return `🛡️ Garantía activa — ${status.daysRemaining} día${status.daysRemaining !== 1 ? "s" : ""} restante${status.daysRemaining !== 1 ? "s" : ""}`;
}

/**
 * Determina si el botón "Reportar Issue" debe estar habilitado para esta orden.
 */
export function isReportIssueButtonEnabled(status: WarrantyStatus): boolean {
  return status.isClaimWindowOpen && status.activeClaimCount === 0;
}

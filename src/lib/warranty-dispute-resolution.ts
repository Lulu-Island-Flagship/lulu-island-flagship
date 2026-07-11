/**
 * v8.3 E5 (Sesión Q) — Resolución de disputa vs. evidencia fotográfica de cierre.
 *
 * Del invariante B.2.2: "La garantía es RELACIONAL A EVIDENCIA fotográfica,
 * no a reloj: los reclamos se resuelven comparando contra la foto de cierre
 * de la zona específica." `evaluateCaptureEligibility` (batch-capture-eligibility.ts,
 * Sesión G) ya decide SI se cobra — esta función decide qué pasa con el
 * reclamo en sí: compara la foto de cierre de la zona reclamada contra la
 * evidencia que el cliente aportó (si la hay).
 *
 * Mismo patrón de diseño que `exPostReviewOutcome` (safety-abort.ts, B.3.5):
 * la evidencia informa, un humano decide. La única excepción — donde SÍ se
 * permite resolver 100% automático en contra del equipo — es la falta total
 * de evidencia del lado de la empresa (no hay ninguna foto de cierre de esa
 * zona): ahí no hay nada que comparar, así que no tiene sentido exigir
 * revisión humana para constatar una ausencia.
 *
 * Tres resultados posibles:
 *   1. No hay foto de cierre para la zona reclamada → la empresa no tiene
 *      evidencia propia. Se resuelve AUTOMÁTICAMENTE a favor del cliente
 *      (re-servicio gratis), sin revisión humana.
 *   2. Hay foto de cierre para la zona Y el cliente NO aportó evidencia
 *      propia → reclamo sin respaldo. Se resuelve con explicación (se
 *      muestra la foto de cierre), automáticamente, SIN sanción ni acción
 *      automática en contra del equipo — pero tampoco a ciegas en contra
 *      del cliente: el pago no se congela por defecto (eso ya lo decide
 *      evaluateCaptureEligibility, no esta función).
 *   3. Hay foto de cierre para la zona Y el cliente SÍ aportó su propia
 *      evidencia → evidencia contra evidencia, potencialmente contradictoria.
 *      Esta función NUNCA decide sola en ese caso — siempre requiere
 *      revisión humana (el humano compara ambas fotos y decide re-limpieza
 *      o no).
 *
 * Función pura: no toca Supabase. El caller (route.ts) arma `zones` a partir
 * de service_checklist_items + sop_checklists (foto de cierre) y `claim` a
 * partir de warranty_claims + warranty_photo_evidence (evidencia del cliente).
 */

/** Estado de evidencia de cierre para una zona del checklist de la orden. */
export interface ZoneClosureEvidence {
  /** Código de zona, mismo vocabulario que sop_checklists.zone (bathroom, kitchen, ...). */
  zone: string;
  zoneLabel?: string;
  /** ¿al menos un ítem del checklist de esta zona tiene foto de evidencia? */
  hasClosurePhoto: boolean;
  closurePhotoUrls: string[];
}

/** La reclamación del cliente, ya con su evidencia (si la hay) resuelta por el caller. */
export interface ClientClaimInput {
  claimZone: string;
  claimReason: string;
  hasClientEvidence: boolean;
  clientEvidencePhotoUrls: string[];
}

export type WarrantyDisputeOutcome =
  | "auto_favor_client_missing_closure_evidence"
  | "auto_favor_team_unsubstantiated_claim"
  | "requires_human_review_contradictory_evidence";

export type WarrantySuggestedAction = "free_recleaning" | "explain_no_action" | "human_review";

export interface WarrantyDisputeResolutionResult {
  outcome: WarrantyDisputeOutcome;
  /** true solo en el caso obvio de "no hay foto de cierre de esa zona" (falta de evidencia de la empresa). */
  autoResolved: boolean;
  /** Inverso de autoResolved: expresado aparte porque es la condición que gobierna el output de la ruta. */
  requiresHumanReview: boolean;
  suggestedAction: WarrantySuggestedAction;
  hasClosureEvidenceForZone: boolean;
  hasClientEvidence: boolean;
  /** Explicación legible, para resolution_notes si el caller no provee una propia. */
  note: string;
}

/**
 * Decide qué pasa con un reclamo de garantía comparando la foto de cierre
 * de la zona reclamada contra la evidencia fotográfica del cliente.
 *
 * @param zones Estado de evidencia de cierre de TODAS las zonas del
 *   checklist de la orden (el caller ya resolvió photo_url != null por zona).
 * @param claim La zona/motivo del reclamo + evidencia del cliente para esa
 *   zona específica.
 */
export function evaluateWarrantyDisputeResolution(
  zones: ZoneClosureEvidence[],
  claim: ClientClaimInput
): WarrantyDisputeResolutionResult {
  const zoneMatch = zones.find((z) => z.zone === claim.claimZone);
  const hasClosureEvidenceForZone = Boolean(zoneMatch?.hasClosurePhoto);
  const hasClientEvidence =
    claim.hasClientEvidence && claim.clientEvidencePhotoUrls.length > 0;

  if (!hasClosureEvidenceForZone) {
    return {
      outcome: "auto_favor_client_missing_closure_evidence",
      autoResolved: true,
      requiresHumanReview: false,
      suggestedAction: "free_recleaning",
      hasClosureEvidenceForZone,
      hasClientEvidence,
      note:
        "No existe foto de cierre para esta zona: falta de evidencia del lado " +
        "de la empresa. Se resuelve a favor del cliente automáticamente " +
        "(re-servicio gratis), sin requerir revisión humana.",
    };
  }

  if (!hasClientEvidence) {
    return {
      outcome: "auto_favor_team_unsubstantiated_claim",
      autoResolved: true,
      requiresHumanReview: false,
      suggestedAction: "explain_no_action",
      hasClosureEvidenceForZone,
      hasClientEvidence,
      note:
        "Existe foto de cierre para la zona reclamada y el cliente no aportó " +
        "evidencia propia: reclamo sin respaldo. Se resuelve con explicación " +
        "(se muestra la foto de cierre al cliente), sin sanción automática " +
        "contra el equipo.",
    };
  }

  return {
    outcome: "requires_human_review_contradictory_evidence",
    autoResolved: false,
    requiresHumanReview: true,
    suggestedAction: "human_review",
    hasClosureEvidenceForZone,
    hasClientEvidence,
    note:
      "Ambas partes aportaron evidencia fotográfica para la misma zona: la " +
      "evidencia informa, pero un humano decide (mismo patrón que " +
      "exPostReviewOutcome en safety-abort.ts). No se resuelve automáticamente " +
      "en contra del equipo.",
  };
}

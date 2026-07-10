/**
 * v8.3 E2.3 / B.2.2 / B.2.18 — Exclusión de disputas del Batch Capture 7PM.
 *
 * Función pura, testeable, sin acceso a base de datos ni a Stripe.
 *
 * Regla de negocio (invariante B.2.2): "Batch Capture a las 7:00 PM, fijo.
 * La garantía es RELACIONAL A EVIDENCIA fotográfica, no a reloj [...] El
 * pago no se congela por defecto." Es decir: una disputa abierta NO excluye
 * por sí sola. Solo excluye una disputa que sea, a la vez:
 *   1. status === 'open'      (no resuelta)
 *   2. severity === 'critical' (discrepancia de >=2 niveles, D.10.3)
 *   3. hasClientEvidence       ("documentada" — el cliente aportó evidencia
 *      fotográfica; sin evidencia no hay nada que comparar y no es
 *      razonable congelar un cobro por una acusación sin respaldo)
 *
 * Mientras no exista comparación automática contra fotos de cierre (E4,
 * no construido), cualquier disputa que cumpla las 3 condiciones se trata
 * como "no concluyente" (B.3.3) y se escala a revisión humana en vez de
 * cobrarse a ciegas o congelarse indefinidamente.
 */

export type WarrantyClaimStatus =
  | "open"
  | "resolved_client"
  | "resolved_lulu"
  | "escalated"
  | "dismissed";

export type WarrantyClaimSeverity = "minor" | "critical";

export interface OrderClaimForCaptureDecision {
  id: string;
  status: WarrantyClaimStatus;
  severity: WarrantyClaimSeverity;
  hasClientEvidence: boolean;
}

export interface CaptureEligibilityResult {
  shouldCapture: boolean;
  /** Machine-readable reason code, siempre presente. */
  reason:
    | "no_open_claims"
    | "open_claims_not_critical_or_not_documented"
    | "critical_documented_dispute_open";
  /** El reclamo bloqueante, si lo hay (para loguear/encolar). */
  blockingClaimId: string | null;
}

/**
 * Decide si una orden debe capturarse en el Batch de las 7PM.
 *
 * @param claims Todas las disputas de garantía asociadas a la orden
 *   (cualquier status), tal como existan en `warranty_claims` +
 *   `warranty_photo_evidence` (join pre-resuelto por el caller).
 */
export function evaluateCaptureEligibility(
  claims: OrderClaimForCaptureDecision[]
): CaptureEligibilityResult {
  if (!claims || claims.length === 0) {
    return { shouldCapture: true, reason: "no_open_claims", blockingClaimId: null };
  }

  const blocking = claims.find(
    (c) => c.status === "open" && c.severity === "critical" && c.hasClientEvidence === true
  );

  if (blocking) {
    return {
      shouldCapture: false,
      reason: "critical_documented_dispute_open",
      blockingClaimId: blocking.id,
    };
  }

  const hasAnyOpen = claims.some((c) => c.status === "open");
  return {
    shouldCapture: true,
    reason: hasAnyOpen ? "open_claims_not_critical_or_not_documented" : "no_open_claims",
    blockingClaimId: null,
  };
}

/**
 * v8.3 E2 (auditoría 2026-07-18) — Pre-autorización silenciosa 2h antes
 * del Batch Capture.
 *
 * Problema: el hold de tarjeta se crea en T-72h (/api/cron/hold-authorize)
 * y nunca se revalida hasta el momento mismo de capturar
 * (/api/cron/batch-capture, 7PM Vancouver). Si el hold expiró, el banco
 * lo canceló o la tarjeta fue rechazada en el ínterin, el primer punto
 * donde se descubre es la noche del servicio, sin margen operativo.
 *
 * Esta función pura decide qué hacer al revalidar un PaymentIntent de
 * hold contra Stripe, 2h antes del capture (17:00 Vancouver). Sigue el
 * mismo patrón "decide" + backoff/tope de intentos que
 * decideQboSyncAction (src/lib/qbo-sync.ts) y evaluateCaptureEligibility
 * (src/lib/batch-capture-eligibility.ts).
 */

export type HoldRevalidationDecision =
  | { action: "hold_valid" }
  | { action: "needs_reauth" }
  | { action: "give_up_notify_ops"; reason: string };

export interface HoldRevalidationInput {
  /** Estado del PaymentIntent recuperado de Stripe (null si el retrieve falló). */
  holdStatus: string | null;
  /** Intentos de re-autorización YA realizados para esta orden en este ciclo. */
  reauthAttempts: number;
  maxReauthAttempts?: number;
}

const DEFAULT_MAX_REAUTH_ATTEMPTS = 3;

export function decideHoldRevalidationAction(
  input: HoldRevalidationInput
): HoldRevalidationDecision {
  const maxAttempts = input.maxReauthAttempts ?? DEFAULT_MAX_REAUTH_ATTEMPTS;

  if (input.holdStatus === "requires_capture") {
    return { action: "hold_valid" };
  }

  if (input.reauthAttempts >= maxAttempts) {
    return {
      action: "give_up_notify_ops",
      reason:
        `Hold inválido (status=${input.holdStatus ?? "unknown"}) tras ` +
        `${input.reauthAttempts} intento(s) de re-autorización silenciosa. ` +
        `Requiere contacto humano con el cliente antes del Batch Capture de las 7PM.`,
    };
  }

  return { action: "needs_reauth" };
}

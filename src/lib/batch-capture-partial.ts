/**
 * v8.3 E2 — Captura parcial cuando el Batch Capture (7PM) encuentra una
 * disputa crítica documentada (ver batch-capture-eligibility.ts).
 *
 * Regla de negocio (decisión del dueño, 2026-07-13): una disputa crítica
 * documentada YA NO congela el cobro por completo. En su lugar:
 *   1. Se cobra DE INMEDIATO, como mínimo, el costo laboral de la orden
 *      (suma de payroll_entries.gross_amount de los empleados asignados)
 *      más un 10% de colchón — nunca se le paga al equipo con dinero que
 *      Lulu Island no llegó a cobrar.
 *   2. El resto (hasta el total de la cotización) se cobra a las 24 horas,
 *      dándole tiempo a Auditoría de Campo/QC a resolver la disputa contra
 *      la evidencia sin que el cliente quede sin cargo indefinidamente.
 *   3. El admin puede forzar el cobro COMPLETO de inmediato pese a la
 *      disputa abierta (p. ej. si ya revisó la evidencia y la considera
 *      infundada) — ver force-full-capture.
 *
 * LIMITACIÓN REAL DE STRIPE que este módulo no puede resolver por sí solo
 * (documentada aquí para quien construya el cron): un PaymentIntent con un
 * Hold en `requires_capture` solo admite UNA llamada de captura. Si se
 * captura menos que el monto autorizado, Stripe LIBERA automáticamente el
 * resto de la autorización — no queda "reservado" para cobrarlo después.
 * Por eso, si el mínimo seguro es menor al Hold ya autorizado, el resto del
 * Hold se libera al capturar solo la porción segura, y el cobro del
 * remanente a las 24h se hace como un cargo NUEVO (mismo mecanismo
 * off-session que ya se usa para el "balance" normal) — que sí puede
 * fallar si la tarjeta ya no es válida, porque para entonces ya no hay
 * autorización viva protegiéndolo. Es un riesgo real del modelo, no un bug:
 * el dueño debe saber que el remanente diferido pierde la garantía de
 * autorización previa.
 */

export interface PartialCaptureDecisionInput {
  /** Total de la cotización, en CENTAVOS. */
  quoteTotalCents: number;
  /**
   * Suma de payroll_entries.gross_amount (CENTAVOS) de todos los empleados
   * asignados a esta orden. `null` si todavía no existe ningún payroll
   * entry para la orden (p. ej. el cierre no terminó de procesarse) — en
   * ese caso NO se puede calcular un mínimo seguro real, así que se trata
   * como "no capturar nada todavía" en vez de inventar un número.
   */
  laborCostCents: number | null;
  /** Colchón sobre el costo laboral. Default 10% (0.10), tal como lo pidió el dueño. */
  laborBufferRatio?: number;
  /** true si un admin ya forzó el cobro completo pese a la disputa. */
  forceFullCapture: boolean;
  /** Momento de referencia (batch run), para calcular remainingDueAt = now + 24h. Default: new Date(). */
  now?: Date;
}

export interface PartialCaptureDecision {
  /** Qué capturar AHORA MISMO, en centavos. Nunca excede quoteTotalCents. */
  captureNowCents: number;
  /** Qué queda pendiente de cobrar a las 24h, en centavos. */
  remainingCents: number;
  /** Cuándo debe correr el cobro del remanente. `null` si remainingCents === 0. */
  remainingDueAt: string | null;
  /** Motivo legible para auditoría/logs. */
  reason:
    | "forced_full_capture"
    | "labor_cost_unknown_defer_all"
    | "labor_cost_covers_full_total"
    | "partial_labor_safe_capture";
}

export const DEFAULT_LABOR_BUFFER_RATIO = 0.1;
export const REMAINDER_DELAY_HOURS = 24;

export function computePartialCaptureDecision(
  input: PartialCaptureDecisionInput
): PartialCaptureDecision {
  const { quoteTotalCents, laborCostCents, forceFullCapture } = input;
  const bufferRatio = input.laborBufferRatio ?? DEFAULT_LABOR_BUFFER_RATIO;
  const now = input.now ?? new Date();

  if (quoteTotalCents <= 0) {
    return { captureNowCents: 0, remainingCents: 0, remainingDueAt: null, reason: "labor_cost_covers_full_total" };
  }

  if (forceFullCapture) {
    return {
      captureNowCents: quoteTotalCents,
      remainingCents: 0,
      remainingDueAt: null,
      reason: "forced_full_capture",
    };
  }

  if (laborCostCents === null) {
    // Sin dato de costo laboral no hay piso seguro que calcular. No se
    // inventa un número -- se difiere TODO el cobro (no se captura nada
    // ahora), igual de conservador que el comportamiento histórico de
    // "excluir del todo", pero explícito en el motivo.
    return {
      captureNowCents: 0,
      remainingCents: quoteTotalCents,
      remainingDueAt: addHours(now, REMAINDER_DELAY_HOURS).toISOString(),
      reason: "labor_cost_unknown_defer_all",
    };
  }

  const minSafeCents = Math.round(laborCostCents * (1 + bufferRatio));
  const captureNowCents = Math.min(Math.max(0, minSafeCents), quoteTotalCents);
  const remainingCents = quoteTotalCents - captureNowCents;

  return {
    captureNowCents,
    remainingCents,
    remainingDueAt: remainingCents > 0 ? addHours(now, REMAINDER_DELAY_HOURS).toISOString() : null,
    reason: remainingCents === 0 ? "labor_cost_covers_full_total" : "partial_labor_safe_capture",
  };
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

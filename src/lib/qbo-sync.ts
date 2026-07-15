/**
 * v8.3 E2.6 — Conciliación QBO 2:00 AM: reintentos con backoff (5 intentos)
 * y alerta de divergencia Shadow Ledger vs QBO (>0.1%).
 *
 * Funciones puras: reciben el estado ya consultado (intentos previos,
 * timestamps, totales) y deciden: nunca tocan la base de datos ni llaman al
 * adaptador QBO directamente.
 */

export const MAX_QBO_SYNC_ATTEMPTS = 5;
/** Backoff exponencial en minutos: intento 1 → 5min, 2 → 10min, 3 → 20min, 4 → 40min, 5 → 80min. */
export const QBO_BACKOFF_BASE_MINUTES = 5;
export const QBO_DIVERGENCE_ALERT_THRESHOLD = 0.001; // 0.1%

export interface QboSyncRetryState {
  attempts: number;
  lastAttemptAtIso: string | null;
}

export type QboSyncDecision =
  | { action: "attempt_now" }
  | { action: "wait_backoff"; retryAfterIso: string }
  | { action: "give_up_pending_sync" };

/** minutos de espera requeridos DESPUÉS de un intento fallido número `attemptNumber` (1-indexado) antes del próximo intento. */
export function computeQboBackoffMinutes(attemptNumber: number): number {
  return QBO_BACKOFF_BASE_MINUTES * Math.pow(2, Math.max(0, attemptNumber - 1));
}

/**
 * Decide qué hacer con una orden pendiente de exportar a QBO dado su
 * historial de intentos:
 *  - Si ya agotó los 5 intentos: dejar de intentar (queda 'pending_sync',
 *    fuera del barrido automático hasta revisión).
 *  - Si el backoff del último intento aún no se cumple: esperar.
 *  - Si ya puede reintentar (o es el primer intento): intentar ahora.
 */
export function decideQboSyncAction(state: QboSyncRetryState, nowIso: string): QboSyncDecision {
  if (state.attempts >= MAX_QBO_SYNC_ATTEMPTS) {
    return { action: "give_up_pending_sync" };
  }
  if (state.attempts === 0 || state.lastAttemptAtIso === null) {
    return { action: "attempt_now" };
  }

  const backoffMinutes = computeQboBackoffMinutes(state.attempts);
  const retryAfterMs = new Date(state.lastAttemptAtIso).getTime() + backoffMinutes * 60 * 1000;
  const nowMs = new Date(nowIso).getTime();

  if (nowMs >= retryAfterMs) {
    return { action: "attempt_now" };
  }
  return { action: "wait_backoff", retryAfterIso: new Date(retryAfterMs).toISOString() };
}

export interface DivergenceEvaluation {
  divergenceRatio: number;
  exceedsThreshold: boolean;
}

/**
 * Compara el total operativo real (Shadow Ledger, fuente de verdad cuando
 * QBO no responde) contra lo efectivamente exportado a QBO en el mismo
 * período. Una divergencia >0.1% dispara la alerta -- puede significar
 * órdenes que nunca se exportaron, se exportaron con monto incorrecto, o un
 * fallo silencioso del proveedor.
 */
export function evaluateQboDivergence(shadowTotalCents: number, qboTotalCents: number): DivergenceEvaluation {
  if (shadowTotalCents === 0) {
    return { divergenceRatio: qboTotalCents === 0 ? 0 : 1, exceedsThreshold: qboTotalCents !== 0 };
  }
  const divergenceRatio = Math.abs(shadowTotalCents - qboTotalCents) / shadowTotalCents;
  return { divergenceRatio, exceedsThreshold: divergenceRatio > QBO_DIVERGENCE_ALERT_THRESHOLD };
}

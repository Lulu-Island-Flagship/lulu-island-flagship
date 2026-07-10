/**
 * v8.3 E4 (D.7) — Timer de superficie caliente en cocina.
 *
 * Regla exacta del plan (D.7, protocolo de zona COCINA):
 *   "estufa/campana con azul (superficie caliente: esperar 10 min, timer en PWA)"
 * Criterio de aceptación E4: "Superficie caliente de cocina: el timer de 10 min
 * existe y bloquea la tarea." — BLOQUEA, no solo alerta: el ítem de checklist
 * de estufa/campana no puede marcarse completado hasta que pasen los 10
 * minutos desde que el empleado inició el temporizador en la PWA.
 *
 * Antes de este módulo no existía ningún timer de cocina en el repo (se
 * verificó con grep sobre src/ completo). Se sigue el mismo patrón que
 * isChemicalAlertTimerExpired (wellbeing.ts) y evaluateSafetyAbortEscalation
 * (safety-abort.ts): función pura, timestamps explícitos, nunca `new Date()`
 * interno, para ser 100% testeable sin navegador.
 */

export const KITCHEN_HOT_SURFACE_WAIT_MINUTES = 10;

/**
 * ¿Ya pasaron los minutos de espera de superficie caliente desde que el
 * empleado inició el temporizador? Si `startedAtIso` es null, el temporizador
 * no ha iniciado — la tarea sigue bloqueada (nunca "expirado por defecto":
 * un timer que nunca inició no puede haber vencido).
 */
export function isKitchenTimerExpired(
  startedAtIso: string | null,
  nowIso: string,
  waitMinutes: number = KITCHEN_HOT_SURFACE_WAIT_MINUTES
): boolean {
  if (!startedAtIso) return false;
  const started = new Date(startedAtIso).getTime();
  const now = new Date(nowIso).getTime();
  const elapsedMinutes = (now - started) / (1000 * 60);
  return elapsedMinutes >= waitMinutes;
}

/**
 * ¿Puede el empleado marcar como completado un ítem de superficie caliente
 * (estufa/campana con azul, D.7)? Solo si el temporizador fue iniciado Y ya
 * venció. Alias semántico de isKitchenTimerExpired para el sitio de consumo
 * (UI / API), que solo debe invocarse para ítems marcados `hotSurface: true`.
 */
export function isHotSurfaceItemUnlocked(
  startedAtIso: string | null,
  nowIso: string,
  waitMinutes: number = KITCHEN_HOT_SURFACE_WAIT_MINUTES
): boolean {
  return isKitchenTimerExpired(startedAtIso, nowIso, waitMinutes);
}

/** Minutos restantes para que el temporizador venza (0 si ya venció o si aún no inicia el conteo hacia 0). */
export function minutesRemaining(
  startedAtIso: string | null,
  nowIso: string,
  waitMinutes: number = KITCHEN_HOT_SURFACE_WAIT_MINUTES
): number {
  if (!startedAtIso) return waitMinutes;
  const started = new Date(startedAtIso).getTime();
  const now = new Date(nowIso).getTime();
  const elapsedMinutes = (now - started) / (1000 * 60);
  return Math.max(0, Math.ceil(waitMinutes - elapsedMinutes));
}

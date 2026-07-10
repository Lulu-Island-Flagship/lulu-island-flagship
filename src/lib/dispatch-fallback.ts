/**
 * v8.3 E3 (D.10, invariante B.2.12) — Fallback de 10 minutos para
 * discrepancias de DESPACHO (asignación de equipo / conflicto de horario).
 *
 * B.2.12 (regla dura general, B.2 #12): "toda decisión que espera al admin
 * tiene timer de 10 min; al vencer, el sistema decide con reglas
 * pre-aprobadas y loguea."
 *
 * Estado real antes de este módulo (verificado leyendo
 * src/app/api/cron/dispatch-scheduler/route.ts): cuando buildTeam()
 * (dispatch-team.ts) devuelve `team: null` (sin líder disponible o sin match
 * de idioma, invariante B.2.13) o cuando evaluateWorkday() bloquea la
 * jornada, la orden se empuja a un array `pendingLanguage` de strings sin
 * timestamp ni timer — queda ahí indefinidamente hasta que un admin la mire
 * a mano. La única otra vía de resolución es la fase de calendario fija
 * "crisis_fallback" (una hora del día, no un timer desde la detección de la
 * discrepancia), que además reasigna con el primer empleado disponible SIN
 * pasar por buildTeam — eso bypasea las reglas duras B.2.13/M0-F0.5 y queda
 * FUERA de alcance de este cambio (es un problema distinto: un fallback de
 * calendario que no respeta reglas, no la ausencia de un timer de 10 min).
 * Documentado aquí para que quede explícito, no corregido en esta sesión.
 *
 * Mismo patrón que isChemicalAlertTimerExpired (wellbeing.ts) y
 * evaluateSafetyAbortEscalation (safety-abort.ts): función pura, timestamps
 * explícitos, nunca `new Date()` interno.
 */

export const DISPATCH_DISCREPANCY_FALLBACK_MINUTES = 10;

export type DispatchDiscrepancyReason =
  | "no_leader_available"
  | "no_language_match"
  | "workday_blocked";

export interface DispatchFallbackResult {
  expired: boolean;
  minutesElapsed: number;
  /**
   * Ninguna de las tres discrepancias de despacho tiene una regla de
   * auto-asignación segura que no viole una regla dura existente (líder
   * obligatorio, match de idioma B.2.13, límites de jornada B.2.15) — por
   * eso la "decisión pre-aprobada" al vencer el timer es escalar la
   * prioridad en la bandeja unificada (tickets_disputas), no auto-asignar a
   * ciegas. Inventar un auto-assign aquí violaría exactamente las reglas
   * que este fallback debe respetar.
   */
  decision: "escalate_to_unified_inbox";
}

/**
 * Evalúa si el timer de 10 min venció para una discrepancia de despacho
 * detectada en `detectedAtIso`. Si el admin ya respondió
 * (`adminRespondedAtIso` no nulo), el timer nunca vence.
 */
export function evaluateDispatchDiscrepancyFallback(
  detectedAtIso: string,
  nowIso: string,
  adminRespondedAtIso: string | null,
  timerMinutes: number = DISPATCH_DISCREPANCY_FALLBACK_MINUTES
): DispatchFallbackResult {
  if (adminRespondedAtIso) {
    return { expired: false, minutesElapsed: 0, decision: "escalate_to_unified_inbox" };
  }
  const detected = new Date(detectedAtIso).getTime();
  const now = new Date(nowIso).getTime();
  const minutesElapsed = (now - detected) / (1000 * 60);
  return {
    expired: minutesElapsed >= timerMinutes,
    minutesElapsed,
    decision: "escalate_to_unified_inbox",
  };
}

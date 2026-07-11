/**
 * v8.3 E3 (D.4, E2 punto 9) — Umbral "equipo #6" del ciclo diario de
 * despacho.
 *
 * Texto exacto del plan (Auditoria 8.3/v8.3_PLAN_DE_CONSTRUCCION.md):
 *
 *   D.4 — "Ciclo diario de despacho: 4:30 PM propuesta óptima → 5:00 PM
 *   corte de reservas → 5:00-5:30 revisión/override del admin (al activar
 *   el equipo #6, default = auto-aprobar salvo alertas rojas) → 5:30 PM
 *   publicación sin excepción."
 *
 *   E2 #9 (Observabilidad) — "Umbral de delegación: al activar el equipo
 *   #6, recordatorio 'considerar coordinador'."
 *
 *   E3 Criterios de aceptación — "Al activar el equipo #6, el default
 *   cambia a auto-aprobar salvo alertas rojas y aparece el recordatorio de
 *   delegación."
 *
 * Lectura literal: "equipo #6" = cuando el número de equipos DISPONIBLES ese
 * día llega a 6 (no es un ID de equipo fijo), dos cosas cambian a la vez en
 * la fase de revisión/override (5:00-5:30 PM):
 *   1. El default de aprobación pasa de "espera manual del admin" a
 *      "auto-aprobar", EXCEPTO si hay alertas rojas.
 *   2. Aparece un recordatorio de delegación ("considerar coordinador").
 *
 * Estado real antes de este módulo (verificado leyendo
 * dispatch-scheduler/route.ts): ya existía `const autoApproved =
 * availableTeams >= 6;` en la fase "published", pero (a) no era una función
 * pura testeable — vivía inline en el route handler —, (b) NO excluía
 * "alertas rojas" como exige el texto del plan (auto-aprobaba siempre con
 * 6+ equipos, sin excepción), y (c) no existía el recordatorio de
 * delegación de E2 #9. Este módulo corrige los tres puntos.
 *
 * Nota de alcance (documentada, no inventada): el plan define "alertas
 * rojas" en D.4 como el semáforo de tránsito >60min de la matriz
 * drag-and-drop del admin (sección E3 "Construir" #5, marcada explícitamente
 * 🎨 WIREFRAME PRIMERO) — esa matriz es UI y hoy no existe un cómputo de
 * tránsito real por orden en el backend (dispatch-scheduler.ts usa
 * DEFAULT_TRANSIT_MINUTES, una constante fija, no GPS/mapas real). Por lo
 * tanto esta función NO decide qué cuenta como alerta roja: recibe
 * `hasRedAlerts` ya evaluado por el llamador. El llamador real
 * (dispatch-scheduler/route.ts) usa como proxy documentado la presencia de
 * discrepancias de despacho sin resolver ese día (sin líder / sin idioma /
 * jornada bloqueada) y jornadas en sobretiempo — no es el semáforo de
 * tránsito del plan, es la mejor señal de riesgo ya disponible en el
 * backend hoy. Ajustar `hasRedAlerts` cuando exista el cómputo real de
 * tránsito de la matriz D.4.
 */

export const TEAM_SIX_AUTO_APPROVAL_THRESHOLD = 6;

export interface DispatchApprovalThresholdResult {
  /** true => "equipo #6" activo (equipos disponibles >= umbral) */
  teamSixActive: boolean;
  /** default de la fase de revisión/override 5:00-5:30 PM */
  autoApproveDefault: boolean;
  /** recordatorio "considerar coordinador" (Umbral de delegación, E2 #9) */
  showDelegationReminder: boolean;
}

/**
 * Evalúa el umbral "equipo #6" para un día de despacho dado.
 *
 * @param availableTeams equipos disponibles ese día (mismo valor que ya
 *   calcula buildProposals() en dispatch-scheduler/route.ts).
 * @param hasRedAlerts señal de riesgo ya evaluada por el llamador (ver nota
 *   de alcance arriba); si es true, NUNCA se auto-aprueba por default aunque
 *   el umbral esté activo.
 * @param threshold umbral configurable para tests; default = 6 (equipo #6).
 */
export function evaluateTeamSixAutoApproval(
  availableTeams: number,
  hasRedAlerts: boolean,
  threshold: number = TEAM_SIX_AUTO_APPROVAL_THRESHOLD
): DispatchApprovalThresholdResult {
  const teamSixActive = availableTeams >= threshold;
  return {
    teamSixActive,
    autoApproveDefault: teamSixActive && !hasRedAlerts,
    showDelegationReminder: teamSixActive,
  };
}

/**
 * v8.3 E8 — Reglas puras de bienestar del empleado.
 *
 * 1. evaluateChemicalRiskAlert: regla dura B.2.x — mal estado + tarea de
 *    riesgo químico ese día → timer de 10 min → sin respuesta admin →
 *    reasignación automática a tareas de bajo riesgo.
 * 2. Modo "No estoy listo": elegibilidad de Day Rate completo por tipo de
 *    aviso + anti-abuso (máx 3/trimestre, patrón viernes/lunes → alerta).
 * 3. Ánimo agregado del equipo: promedio, nunca individual.
 */

// ------------------------------------------------------------
// 1. Alerta de riesgo químico + timer de 10 min
// ------------------------------------------------------------

export const CHEMICAL_ALERT_TIMER_MINUTES = 10;

export type ChemicalAlertResolution = "admin_handled" | "auto_reassigned" | "pending";

/**
 * ¿Ya pasó el timer de 10 min sin respuesta del admin? Si sí, el llamador
 * debe reasignar automáticamente al empleado a tareas de bajo riesgo.
 */
export function isChemicalAlertTimerExpired(
  reportedAtIso: string,
  nowIso: string,
  adminRespondedAtIso: string | null,
  timerMinutes: number = CHEMICAL_ALERT_TIMER_MINUTES
): boolean {
  if (adminRespondedAtIso) return false; // el admin ya actuó, no hay timeout
  const reported = new Date(reportedAtIso).getTime();
  const now = new Date(nowIso).getTime();
  const elapsedMinutes = (now - reported) / (1000 * 60);
  return elapsedMinutes >= timerMinutes;
}

/** ¿Corresponde generar la alerta en primer lugar? Solo si hay tarea de riesgo hoy. */
export function shouldTriggerChemicalWellbeingAlert(
  reportedMood: "happy" | "neutral" | "sad" | null,
  reportedSleptWell: boolean | null,
  hasChemicalRiskTaskToday: boolean
): boolean {
  if (!hasChemicalRiskTaskToday) return false;
  const badState = reportedMood === "sad" || reportedSleptWell === false;
  return badState;
}

// ------------------------------------------------------------
// 2. Modo "No estoy listo"
// ------------------------------------------------------------

export type ReadinessRequestType = "illness" | "family_emergency" | "no_transport";

export const ILLNESS_MIN_NOTICE_HOURS = 2;
export const MAX_REQUESTS_PER_QUARTER = 3;

export interface ReadinessDecision {
  fullDayRate: boolean;
  reason: string;
}

/**
 * ¿Este aviso califica para Day Rate completo (B.2.6)?
 * - Enfermedad avisada con >=2h de anticipación: Day Rate completo.
 * - Emergencia familiar: Day Rate completo, máximo 1 vez por trimestre
 *   (se valida con `familyEmergenciesThisQuarter` ANTES de este llamado).
 * - Sin transporte: no aplica Day Rate por sí solo; requiere reasignación o
 *   recogida (decisión operativa, no económica).
 */
export function evaluateReadinessRequest(
  type: ReadinessRequestType,
  noticeHours: number,
  familyEmergenciesThisQuarter: number = 0
): ReadinessDecision {
  if (type === "illness") {
    if (noticeHours >= ILLNESS_MIN_NOTICE_HOURS) {
      return { fullDayRate: true, reason: `Enfermedad avisada con ${noticeHours}h de anticipación (>= ${ILLNESS_MIN_NOTICE_HOURS}h).` };
    }
    return { fullDayRate: false, reason: `Aviso de enfermedad con menos de ${ILLNESS_MIN_NOTICE_HOURS}h de anticipación.` };
  }
  if (type === "family_emergency") {
    if (familyEmergenciesThisQuarter < 1) {
      return { fullDayRate: true, reason: "Emergencia familiar (1ra vez este trimestre)." };
    }
    return { fullDayRate: false, reason: "Emergencia familiar ya usada este trimestre (máx 1x)." };
  }
  // no_transport: no otorga Day Rate automático por sí solo.
  return { fullDayRate: false, reason: "Sin transporte: requiere reasignación o recogida, no aplica Day Rate automático." };
}

export interface AbusePatternResult {
  exceedsQuarterLimit: boolean;
  fridayMondayPattern: boolean;
}

/**
 * Anti-abuso: máximo 3 solicitudes por trimestre (cualquier tipo combinado);
 * patrón viernes/lunes recurrente → alerta (indicio de fines de semana largos).
 */
export function detectAbusePattern(
  requestDatesIso: string[] // fechas de solicitudes YA incluyendo la nueva, mismo trimestre
): AbusePatternResult {
  const exceedsQuarterLimit = requestDatesIso.length > MAX_REQUESTS_PER_QUARTER;

  const fridayOrMondayCount = requestDatesIso.filter((d) => {
    const day = new Date(d + "T12:00:00Z").getUTCDay(); // 0=domingo, 5=viernes, 1=lunes
    return day === 5 || day === 1;
  }).length;

  // Patrón: al menos 2 de las solicitudes cayeron en viernes/lunes.
  const fridayMondayPattern = fridayOrMondayCount >= 2;

  return { exceedsQuarterLimit, fridayMondayPattern };
}

// ------------------------------------------------------------
// 3. Ánimo agregado del equipo
// ------------------------------------------------------------

export interface TeamMoodDay {
  date: string;
  neutralOrSadCount: number;
  totalCount: number;
}

/**
 * Equipo con ánimo bajo (neutral o triste) en >=5 de los últimos días
 * registrados → sugerir "café con Equipo X". Nunca identifica individuos.
 */
export function shouldSuggestTeamCheckin(days: TeamMoodDay[], thresholdDays: number = 5): boolean {
  const lowMoodMajorityDays = days.filter(
    (d) => d.totalCount > 0 && d.neutralOrSadCount / d.totalCount >= 0.5
  );
  return lowMoodMajorityDays.length >= thresholdDays;
}

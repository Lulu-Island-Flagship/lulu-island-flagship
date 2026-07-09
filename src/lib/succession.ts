/**
 * v8.3 E11 (D.11.1) — Modo Sucesión: activación automática por inactividad, y
 * alerta de burnout separada (más temprana, más suave).
 *
 * Distinción central que el spec exige explícitamente: "entrar al sistema"
 * (login / GET) NO es lo mismo que "engagement operativo real" (una acción
 * de escritura: aprobar algo, cambiar una regla, resolver un ticket). Un
 * dueño que solo mira el dashboard sin actuar sigue en riesgo de burnout o
 * de que el negocio esté, en la práctica, sin timón.
 *
 * Por diseño, estas funciones NUNCA reciben "último login" como señal de
 * actividad — solo reciben acciones de escritura ya filtradas por el
 * llamador (admin_action_logs, que según E0-C3 solo registra escrituras,
 * nunca GET/HEAD). Esto hace estructuralmente imposible confundir las dos
 * señales dentro de esta función.
 */

export const BURNOUT_ALERT_DAYS = 10;
export const SUCCESSION_ALERT_DAYS = 14;
export const SUCCESSION_AUTO_ACTIVATE_DAYS = 21;

export interface WriteAction {
  createdAt: string; // ISO — acción de escritura real (POST/PATCH/PUT/DELETE admin)
}

/** Fecha ISO de la acción de escritura más reciente, o null si no hay ninguna. */
export function lastRealEngagement(actions: WriteAction[]): string | null {
  if (actions.length === 0) return null;
  return actions.reduce((latest, a) => (a.createdAt > latest ? a.createdAt : latest), actions[0].createdAt);
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  return (to - from) / (1000 * 60 * 60 * 24);
}

export type SuccessionStatus = "normal" | "burnout_alert" | "succession_alert" | "auto_activate";

/**
 * Evalúa el estado combinado (burnout + sucesión) a partir de la última
 * acción de escritura real. `nowIso` se pasa explícito para que la función
 * sea pura y testeable (no usa `new Date()` internamente para "ahora").
 *
 * Si nunca hubo ninguna acción real (lastEngagementIso = null), se trata
 * como "siempre inactivo" — cuenta desde `accountCreatedIso`.
 */
export function evaluateSuccessionStatus(
  lastEngagementIso: string | null,
  accountCreatedIso: string,
  nowIso: string
): { status: SuccessionStatus; daysSinceEngagement: number } {
  const baseline = lastEngagementIso ?? accountCreatedIso;
  const days = daysBetween(baseline, nowIso);

  let status: SuccessionStatus = "normal";
  if (days >= SUCCESSION_AUTO_ACTIVATE_DAYS) status = "auto_activate";
  else if (days >= SUCCESSION_ALERT_DAYS) status = "succession_alert";
  else if (days >= BURNOUT_ALERT_DAYS) status = "burnout_alert";

  return { status, daysSinceEngagement: days };
}

/**
 * Activación inmediata (sin esperar umbral de días): incapacidad declarada
 * o fallecimiento (con documento legal). Estas nunca dependen de inactividad.
 */
export type ImmediateTrigger = "incapacity_declared" | "death_certified";

export function immediateActivationReason(trigger: ImmediateTrigger): string {
  return trigger === "incapacity_declared"
    ? "Incapacidad declarada — activación inmediata de Modo Sucesión."
    : "Fallecimiento certificado — activación inmediata de Modo Sucesión.";
}

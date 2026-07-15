/**
 * v8.3 E9.9 — PIPEDA operativo. Funciones puras (sin acceso a DB/reloj real,
 * todo recibe "ahora" como input) para los tres derechos del sujeto de
 * datos (acceso, corrección, eliminación) y el protocolo de brecha.
 *
 * Contexto: grep -rli "pipeda" src -> vacío antes de este archivo. No
 * existía NINGÚN soporte de código para esta obligación legal, pese a que
 * el criterio de aceptación de E9 la exige explícitamente.
 */

export const ACCESS_REQUEST_DUE_HOURS = 48;
export const BREACH_NOTIFICATION_DUE_HOURS = 72;
export const DELETION_RETENTION_YEARS = 2;
export const LEGAL_FEED_BLIND_THRESHOLD_DAYS = 30;

export type DataSubjectRequestType = "access" | "correction" | "deletion";

/**
 * Fecha límite para una solicitud, según el tipo. El plan (E9.9) solo fija
 * un plazo duro para "acceso" (48h, "exportación 48h"). Corrección y
 * eliminación no tienen plazo legal fijo en el texto del plan -- se les
 * asigna el mismo SLA operativo de 48h para que nunca queden "flotando"
 * sin fecha de revisión, pero esto es una decisión operativa, no una cita
 * textual del plan, y debe poder ajustarse sin tocar la forma de la tabla.
 */
export function computeRequestDueAt(requestedAt: Date): Date {
  return new Date(requestedAt.getTime() + ACCESS_REQUEST_DUE_HOURS * 60 * 60 * 1000);
}

/** Fecha en la que una solicitud de eliminación puede purgarse de verdad:
 * soft delete inmediato + retención fiscal de 2 años (E9.9 / E9.12). */
export function computePurgeEligibleAt(softDeletedAt: Date): Date {
  const d = new Date(softDeletedAt);
  d.setUTCFullYear(d.getUTCFullYear() + DELETION_RETENTION_YEARS);
  return d;
}

/** Fecha límite para notificar OIPC BC + afectados tras una brecha: 72h
 * desde la detección (E9.9). */
export function computeBreachNotificationDueAt(detectedAt: Date): Date {
  return new Date(detectedAt.getTime() + BREACH_NOTIFICATION_DUE_HOURS * 60 * 60 * 1000);
}

export function isRequestOverdue(dueAt: Date, now: Date, status: string): boolean {
  if (status === "completed" || status === "denied") return false;
  return now.getTime() > dueAt.getTime();
}

export function isBreachNotificationOverdue(
  notificationDueAt: Date,
  now: Date,
  oipcNotifiedAt: Date | null,
  affectedNotifiedAt: Date | null
): boolean {
  if (oipcNotifiedAt && affectedNotifiedAt) return false;
  return now.getTime() > notificationDueAt.getTime();
}

/** ¿Un feed legal está "ciego" (E9.7)? -- no se ha marcado como chequeado
 * en más de 30 días, sin importar su frecuencia declarada. `lastCheckedAt`
 * NULL (nunca chequeado) cuenta como ciego desde `createdAt`. */
export function isFeedBlind(
  lastCheckedAt: Date | null,
  createdAt: Date,
  now: Date
): boolean {
  const reference = lastCheckedAt ?? createdAt;
  const daysSince = (now.getTime() - reference.getTime()) / (1000 * 60 * 60 * 24);
  return daysSince > LEGAL_FEED_BLIND_THRESHOLD_DAYS;
}

/** Próxima fecha de revisión manual trimestral (E9.7 fallback), contando
 * desde una fecha base (normalmente la última revisión completada o la
 * fecha de arranque del módulo). */
export function computeNextQuarterlyReviewDate(fromDate: Date): Date {
  const d = new Date(fromDate);
  d.setUTCMonth(d.getUTCMonth() + 3);
  return d;
}

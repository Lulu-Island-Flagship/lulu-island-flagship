/**
 * v8.3 E7 (D.7.5) — Manejo de llaves.
 * en persona / lockbox / tercero / problema -> escala 15 min -> no-show documentado.
 */

export type KeyMethod = "in_person" | "lockbox" | "third_party" | "problem";

export const KEY_PROBLEM_ESCALATION_MINUTES = 15;

export interface KeyLogRequirements {
  requiresLockboxCode: boolean;
  requiresConfirmedReturn: boolean;
  requiresSignature: boolean;
  requiresClosingPhoto: boolean;
}

/** Qué campos son obligatorios según el método elegido. */
export function requirementsForMethod(method: KeyMethod): KeyLogRequirements {
  return {
    requiresLockboxCode: method === "lockbox",
    requiresConfirmedReturn: method === "in_person",
    requiresSignature: method === "third_party",
    requiresClosingPhoto: method === "lockbox",
  };
}

/** ¿Ya pasó el timer de escalación de un "problema" de acceso sin resolver? */
export function isKeyProblemEscalationDue(
  reportedAtIso: string,
  nowIso: string,
  resolvedAtIso: string | null,
  timerMinutes: number = KEY_PROBLEM_ESCALATION_MINUTES
): boolean {
  if (resolvedAtIso) return false;
  const reported = new Date(reportedAtIso).getTime();
  const now = new Date(nowIso).getTime();
  const elapsedMinutes = (now - reported) / (1000 * 60);
  return elapsedMinutes >= timerMinutes;
}

/**
 * Valida que el log tenga los campos requeridos por su método antes de
 * aceptarlo (falla ruidosamente, igual que renderTemplate en communications.ts).
 */
export function validateKeyLog(
  method: KeyMethod,
  fields: { lockboxCode?: string; confirmedReturned?: boolean; signatureUrl?: string; closingPhotoUrl?: string }
): string[] {
  const req = requirementsForMethod(method);
  const missing: string[] = [];
  if (req.requiresLockboxCode && !fields.lockboxCode) missing.push("lockboxCode");
  if (req.requiresConfirmedReturn && fields.confirmedReturned !== true) missing.push("confirmedReturned");
  if (req.requiresSignature && !fields.signatureUrl) missing.push("signatureUrl");
  if (req.requiresClosingPhoto && !fields.closingPhotoUrl) missing.push("closingPhotoUrl");
  return missing;
}

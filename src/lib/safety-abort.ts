/**
 * v8.3 E7 (D.10 excepción #7) — Aborto seguro: la única de las 10 excepciones
 * de campo que es P0 (seguridad humana) por encima de cualquier otra regla.
 *
 * Flujo canónico del spec:
 *   doble confirmación → SOS con GPS vivo → llamada auto a admin (2 min) →
 *   Admin de Emergencia (4 min) → Fallback 10 min: auto-aprobado por seguridad.
 *
 * Regla dura (B.3.5): el sistema APRUEBA PRIMERO por seguridad. La revisión
 * humana ex-post es SIEMPRE obligatoria, sin excepción, y si la evidencia
 * respalda al líder, la sanción está PROHIBIDA (nunca automática, nunca
 * discrecional en contra de esa evidencia).
 *
 * Funciones puras: reciben timestamps explícitos (nunca `new Date()` interno),
 * igual que succession.ts y key-handling.ts, para ser 100% testeables.
 */

export const SOS_ADMIN_CALL_MINUTES = 2;
export const SOS_EMERGENCY_ADMIN_MINUTES = 4;
export const SOS_AUTO_APPROVE_MINUTES = 10;

/** ¿La doble confirmación está completa? Ambos pasos son obligatorios antes de activar SOS. */
export function isDoubleConfirmed(
  firstConfirmedAtIso: string | null,
  secondConfirmedAtIso: string | null
): boolean {
  return Boolean(firstConfirmedAtIso && secondConfirmedAtIso);
}

export type SafetyAbortStage =
  | "sos_active" // 0-2 min, esperando respuesta
  | "escalated_admin_call" // 2-4 min sin ack: llamada automática al admin
  | "escalated_emergency_admin" // 4-10 min sin ack: Admin de Emergencia
  | "auto_approved" // 10+ min sin ack: aprobado automáticamente por seguridad
  | "acknowledged"; // un admin (cualquier nivel) reconoció el SOS antes del auto-approve

export interface SafetyAbortEscalationResult {
  stage: SafetyAbortStage;
  minutesElapsed: number;
  autoApproved: boolean;
}

function minutesBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  return (to - from) / (1000 * 60);
}

/**
 * Evalúa en qué etapa de la cadena de escalación está un SOS activo.
 * `acknowledgedAtIso` detiene la escalación apenas un admin (de cualquier
 * nivel) confirma que está atendiendo — el reloj de auto-aprobación por
 * seguridad NUNCA se revierte, solo se detiene hacia adelante.
 */
export function evaluateSafetyAbortEscalation(
  sosStartedAtIso: string,
  nowIso: string,
  acknowledgedAtIso: string | null
): SafetyAbortEscalationResult {
  if (acknowledgedAtIso) {
    return {
      stage: "acknowledged",
      minutesElapsed: minutesBetween(sosStartedAtIso, acknowledgedAtIso),
      autoApproved: false,
    };
  }

  const minutesElapsed = minutesBetween(sosStartedAtIso, nowIso);

  let stage: SafetyAbortStage = "sos_active";
  if (minutesElapsed >= SOS_AUTO_APPROVE_MINUTES) {
    stage = "auto_approved";
  } else if (minutesElapsed >= SOS_EMERGENCY_ADMIN_MINUTES) {
    stage = "escalated_emergency_admin";
  } else if (minutesElapsed >= SOS_ADMIN_CALL_MINUTES) {
    stage = "escalated_admin_call";
  }

  return { stage, minutesElapsed, autoApproved: stage === "auto_approved" };
}

/**
 * Revisión ex-post (punto #5 de B.3: uno de los 6 únicos puntos de
 * intervención humana obligatoria). Es SIEMPRE requerida, sin excepción,
 * para todo aborto seguro — sin importar en qué etapa se auto-aprobó.
 */
export function exPostReviewRequired(): true {
  return true;
}

export interface ExPostReviewOutcome {
  sanctionProhibited: boolean;
  note: string;
}

/**
 * Resultado de la revisión ex-post. Si la evidencia respalda al líder, la
 * sanción queda PROHIBIDA — esta función nunca permite que un caller la
 * habilite en ese escenario (regla dura de B.3.5, no una sugerencia).
 */
export function exPostReviewOutcome(evidenceSupportsLeader: boolean): ExPostReviewOutcome {
  return evidenceSupportsLeader
    ? {
        sanctionProhibited: true,
        note: "Evidencia respalda al líder: sanción prohibida (B.3.5). El aborto se mantiene aprobado.",
      }
    : {
        sanctionProhibited: false,
        note: "Evidencia no respalda al líder: procede evaluación humana del caso (el despido final siempre lo decide un humano, B.2.23).",
      };
}

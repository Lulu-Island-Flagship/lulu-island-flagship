/**
 * v8.3 E10 (D.10.9) — Detección de fuga (churn). Función pura de clasificación,
 * no ejecuta nada por sí sola (enviar la encuesta/descuento sigue pasando por
 * el motor de comunicaciones de E6, con su propio throttling).
 */

export type ClientPattern = "recurring" | "sporadic";

export interface ChurnSignalInput {
  pattern: ClientPattern;
  daysSinceLastService: number;
  cancelledWithCompetitorMention: boolean;
  teamScoreTrend?: { previous: number; current: number }; // 0-100
}

export type ChurnAction =
  | "survey_20"
  | "discount_30_percent"
  | "personal_intervention"
  | "flag_unreported_dispute"
  | "none";

export interface ChurnSignal {
  action: ChurnAction;
  reason: string;
}

/**
 * Reglas literales del spec D.10.9:
 *   - recurrente 60 días sin servicio -> encuesta con $20
 *   - esporádico 90 días sin servicio -> 30% off
 *   - cancelación + mención de competidor -> intervención personal
 *   - score de equipo degradado >70 -> <40 -> "¿disputa no reportada?"
 * Se evalúan en este orden porque cancelación+competidor es la señal más
 * urgente (cliente ya decidió irse), y el flag de score es independiente
 * del ciclo de inactividad.
 */
export function detectChurnSignal(input: ChurnSignalInput): ChurnSignal {
  if (input.cancelledWithCompetitorMention) {
    return {
      action: "personal_intervention",
      reason: "Cancelación con mención de competidor: requiere contacto personal, no automatizado.",
    };
  }

  if (
    input.teamScoreTrend &&
    input.teamScoreTrend.previous > 70 &&
    input.teamScoreTrend.current < 40
  ) {
    return {
      action: "flag_unreported_dispute",
      reason: `Score de equipo cayó de ${input.teamScoreTrend.previous} a ${input.teamScoreTrend.current}: posible disputa no reportada.`,
    };
  }

  if (input.pattern === "recurring" && input.daysSinceLastService >= 60) {
    return {
      action: "survey_20",
      reason: `Cliente recurrente sin servicio hace ${input.daysSinceLastService} días (umbral 60): encuesta con incentivo $20.`,
    };
  }

  if (input.pattern === "sporadic" && input.daysSinceLastService >= 90) {
    return {
      action: "discount_30_percent",
      reason: `Cliente esporádico sin servicio hace ${input.daysSinceLastService} días (umbral 90): oferta de reactivación 30% off.`,
    };
  }

  return { action: "none", reason: "Sin señales de fuga." };
}

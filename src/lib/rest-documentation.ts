import { BREAK_MINUTES, BREAK_AFTER_MINUTES } from "@/lib/workday";

/**
 * v8.3 — Documentación de descanso vía tránsito al carro (BC ESA: 30 min
 * sin goce de sueldo tras 5h continuas de trabajo, Employment Standards
 * Act s.32).
 *
 * Contexto real del negocio: un servicio dura en promedio ~3h; al
 * terminar (evento service_logs 't_out'), el equipo camina/maneja al
 * vehículo antes del siguiente servicio ('t_in' del siguiente order).
 * Ese tramo de tránsito es un descanso real y verificable -- esta lib
 * decide si CALIFICA como el descanso legal de 30 min, sin inventar que
 * "todo tránsito es descanso" de forma automática.
 *
 * Distinción honesta que el negocio pidió pasar por alto pero que la ley
 * no permite pasar por alto: el CONDUCTOR sigue trabajando mientras
 * maneja (operar el vehículo es una tarea, no un descanso libre de
 * deberes) -- un descanso de la ESA debe estar completamente libre de
 * obligaciones. Por eso esta lib NUNCA marca el tránsito como descanso
 * válido para quien conduce, aunque sí lo registra como tiempo de
 * tránsito (relevante para nómina/horas). Para los pasajeros del mismo
 * tramo, sí puede calificar si dura ≥30 min Y ocurre después de que el
 * empleado ya acumuló 5h continuas de trabajo ese día.
 *
 * Limitación de datos, documentada: el sistema no registra hoy quién
 * condujo en cada tramo específico (solo employees.role='driver' como
 * rol de empleo). Si nadie tiene ese rol en el equipo, el líder conduce
 * (D.4) pero eso no queda capturado por tramo -- se usa el rol de empleo
 * como mejor señal disponible, documentado como aproximación.
 */

export type RestRole = "driver" | "passenger" | "solo_no_vehicle";

export interface RestDocumentationInput {
  transitMinutes: number;
  /** Minutos de trabajo continuo acumulados ANTES de este tramo de tránsito (desde el último descanso calificado o el inicio de jornada). */
  cumulativeContinuousMinutesBefore: number;
  role: RestRole;
}

export interface RestDocumentationResult {
  satisfiesEsaBreak: boolean;
  reason: string;
}

export function decideRestDocumentation(input: RestDocumentationInput): RestDocumentationResult {
  const { transitMinutes, cumulativeContinuousMinutesBefore, role } = input;

  if (role === "driver") {
    return {
      satisfiesEsaBreak: false,
      reason: "driving_is_work_not_a_break",
    };
  }

  if (cumulativeContinuousMinutesBefore < BREAK_AFTER_MINUTES) {
    return {
      satisfiesEsaBreak: false,
      reason: "break_not_yet_due_under_5h_continuous_threshold",
    };
  }

  if (transitMinutes < BREAK_MINUTES) {
    return {
      satisfiesEsaBreak: false,
      reason: `transit_shorter_than_required_${BREAK_MINUTES}_minutes`,
    };
  }

  return { satisfiesEsaBreak: true, reason: "transit_break_satisfies_esa_30min_after_5h" };
}

/**
 * Tras un descanso que SÍ calificó, el contador de trabajo continuo se
 * reinicia a 0. Si el tramo no calificó, el trabajo antes del tránsito
 * sigue acumulando (el tránsito en sí no cuenta como "trabajo" para este
 * contador si el empleado no es el conductor; si lo es, sí sigue
 * trabajando y por tanto sigue acumulando).
 */
export function computeContinuousMinutesAfterTransit(
  cumulativeBefore: number,
  transitMinutes: number,
  decision: RestDocumentationResult,
  role: RestRole
): number {
  if (decision.satisfiesEsaBreak) return 0;
  if (role === "driver") return cumulativeBefore + transitMinutes;
  return cumulativeBefore; // pasajero en un tránsito que no calificó: no trabajó, pero tampoco reinició el contador
}

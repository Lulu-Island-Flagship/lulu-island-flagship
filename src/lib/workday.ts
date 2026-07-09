/**
 * v8.3 E3 — Reglas de JORNADA (invariantes B.2.14/15, BC Employment Standards):
 *   - Pausa obligatoria de 30 min NO remunerados tras 5h continuas — el motor
 *     la reserva explícitamente (no es "si alcanza").
 *   - Turno estándar 8h incluyendo tránsito; >8h = ALERTA (requiere
 *     autorización admin, recargo 1.5x); >10h = BLOQUEO absoluto.
 * Funciones puras sobre minutos — testeables sin base de datos.
 */

export const BREAK_AFTER_MINUTES = 5 * 60; // 5h continuas
export const BREAK_MINUTES = 30;
export const STANDARD_DAY_MINUTES = 8 * 60; // 8h incluyendo tránsito
export const MAX_DAY_MINUTES = 10 * 60; // 10h con autorización — jamás más

export interface WorkBlock {
  /** minutos de servicio (HHE/N ya repartido) */
  serviceMinutes: number;
  /** minutos de tránsito hacia este servicio */
  transitMinutes: number;
}

export interface WorkdayEvaluation {
  totalWorkMinutes: number;
  requiredBreaks: number;
  /** total con pausas reservadas */
  totalDayMinutes: number;
  status: "ok" | "overtime_needs_approval" | "blocked";
  reasons: string[];
}

/**
 * Evalúa la jornada propuesta de UN empleado (bloques en orden del día).
 * Reserva pausas de 30 min por cada tramo de 5h de trabajo continuo.
 */
export function evaluateWorkday(blocks: WorkBlock[]): WorkdayEvaluation {
  const totalWorkMinutes = blocks.reduce(
    (acc, b) => acc + Math.max(0, b.serviceMinutes) + Math.max(0, b.transitMinutes),
    0
  );

  // Pausas obligatorias: una por cada 5h completas de trabajo
  // (a las 5h exactas ya se debe UNA pausa — Math.floor cubre el borde)
  const requiredBreaks = totalWorkMinutes >= BREAK_AFTER_MINUTES
    ? Math.floor(totalWorkMinutes / BREAK_AFTER_MINUTES)
    : 0;

  const totalDayMinutes = totalWorkMinutes + requiredBreaks * BREAK_MINUTES;

  const reasons: string[] = [];
  let status: WorkdayEvaluation["status"] = "ok";

  if (requiredBreaks > 0) {
    reasons.push(
      `${requiredBreaks} pausa(s) de ${BREAK_MINUTES} min reservada(s) (BC ESA: 30 min tras 5h continuas)`
    );
  }

  if (totalDayMinutes > MAX_DAY_MINUTES) {
    status = "blocked";
    reasons.push(
      `BLOQUEADO: jornada de ${(totalDayMinutes / 60).toFixed(1)}h supera el máximo absoluto de 10h (v8.3 B.2.15)`
    );
  } else if (totalDayMinutes > STANDARD_DAY_MINUTES) {
    status = "overtime_needs_approval";
    reasons.push(
      `Jornada de ${(totalDayMinutes / 60).toFixed(1)}h supera las 8h estándar: requiere autorización admin y recargo 1.5x sobre el excedente`
    );
  }

  return { totalWorkMinutes, requiredBreaks, totalDayMinutes, status, reasons };
}

/**
 * ¿Cabe un bloque adicional en la jornada sin romper el tope de 10h?
 * (para que el motor de despacho descarte candidatos ya cargados)
 */
export function fitsInWorkday(existing: WorkBlock[], candidate: WorkBlock): boolean {
  return evaluateWorkday([...existing, candidate]).status !== "blocked";
}

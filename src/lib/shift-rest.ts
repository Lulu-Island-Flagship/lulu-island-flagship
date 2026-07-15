/**
 * v8.3 — Descanso entre turnos (BC ESA s.32: mínimo 8h libres entre el
 * fin de un turno y el inicio del siguiente) y descanso semanal (mínimo
 * 32h consecutivas libres por semana, ESA s.35).
 *
 * Funciones puras -- sin acceso a base de datos ni reloj real.
 */

export const MIN_REST_BETWEEN_SHIFTS_HOURS = 8;
export const MIN_WEEKLY_CONSECUTIVE_REST_HOURS = 32;

export interface RestBetweenShiftsResult {
  gapHours: number;
  satisfiesMinimumRest: boolean;
}

/** ¿Hay al menos 8h libres entre el fin del turno anterior y el inicio del propuesto? */
export function hasMinimumRestBetweenShifts(
  previousShiftEndISO: string,
  nextShiftStartISO: string
): RestBetweenShiftsResult {
  const gapMs = new Date(nextShiftStartISO).getTime() - new Date(previousShiftEndISO).getTime();
  const gapHours = gapMs / (1000 * 60 * 60);
  return { gapHours, satisfiesMinimumRest: gapHours >= MIN_REST_BETWEEN_SHIFTS_HOURS };
}

export interface ShiftInterval {
  startISO: string;
  endISO: string;
}

export interface WeeklyRestResult {
  longestGapHours: number;
  satisfiesWeeklyRest: boolean;
}

/**
 * De una lista de turnos en una ventana de 7 días, encuentra el gap más
 * largo entre turnos consecutivos (ordenados) y decide si alcanza las
 * 32h consecutivas exigidas. Con 0 o 1 turnos no hay gap que medir --
 * se considera que el descanso SÍ se cumple (no hay evidencia de lo
 * contrario, no se puede inventar un incumplimiento).
 */
export function evaluateWeeklyRest(shifts: ShiftInterval[]): WeeklyRestResult {
  if (shifts.length < 2) {
    return { longestGapHours: Infinity, satisfiesWeeklyRest: true };
  }

  const sorted = [...shifts].sort((a, b) => new Date(a.startISO).getTime() - new Date(b.startISO).getTime());

  let longestGapHours = 0;
  for (let i = 1; i < sorted.length; i++) {
    const gapMs = new Date(sorted[i].startISO).getTime() - new Date(sorted[i - 1].endISO).getTime();
    const gapHours = gapMs / (1000 * 60 * 60);
    if (gapHours > longestGapHours) longestGapHours = gapHours;
  }

  return {
    longestGapHours,
    satisfiesWeeklyRest: longestGapHours >= MIN_WEEKLY_CONSECUTIVE_REST_HOURS,
  };
}

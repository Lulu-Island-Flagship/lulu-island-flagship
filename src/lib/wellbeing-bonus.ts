/**
 * v8.3 E8 FIX-3 — Lógica pura de racha del checklist matutino (+$5).
 *
 * checkin/page.tsx nunca prometió este bono explícitamente (solo el atajo
 * de ruta a +$10, ver route_shortcuts + FIX-4), pero la auditoría marcó que
 * "Bonos $5/$10 sin backend real" -- esta función es el backend real para
 * la mitad que tiene sentido pagar automáticamente: 5 días CONSECUTIVOS
 * (calendario, sin saltarse ninguno) con checklist matutino enviado.
 *
 * Función pura y testeable sin DB: recibe las fechas (YYYY-MM-DD) de los
 * checkins más recientes del empleado (cualquier orden) y decide si HOY
 * cierra una racha de 5 días que todavía no se pagó.
 */

const STREAK_LENGTH = 5;
export const CHECKIN_STREAK_BONUS_CENTS = 500; // $5.00
export const SHORTCUT_VALIDATED_BONUS_CENTS = 1000; // $10.00

function toUTCDate(iso: string): number {
  // Compara solo por día calendario (YYYY-MM-DD), ignora hora/zona horaria
  // de cómo llegó el string -- daily_checkins.checkin_date ya es DATE puro.
  return Date.parse(`${iso}T00:00:00Z`);
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param checkinDatesDesc Fechas (YYYY-MM-DD) de checkins existentes del
 *   empleado, en cualquier orden (se ordenan acá). Debe incluir la fecha de
 *   hoy si el checkin de hoy ya se guardó antes de llamar esta función.
 * @param todayISO Fecha de referencia (YYYY-MM-DD).
 * @param alreadyPaidCreditDates Fechas (credit_date) que ya tienen un bono
 *   'checkin_streak_5day' pagado -- para no volver a ofrecerlas.
 */
export function evaluateCheckinStreakBonus(
  checkinDatesDesc: string[],
  todayISO: string,
  alreadyPaidCreditDates: string[]
): { eligible: boolean; creditDate: string | null } {
  if (alreadyPaidCreditDates.includes(todayISO)) {
    return { eligible: false, creditDate: null };
  }

  const uniqueSorted = Array.from(new Set(checkinDatesDesc)).sort(
    (a, b) => toUTCDate(b) - toUTCDate(a)
  );

  if (uniqueSorted[0] !== todayISO) {
    // El checkin de hoy no está en el set -- no hay racha que cierre hoy.
    return { eligible: false, creditDate: null };
  }

  if (uniqueSorted.length < STREAK_LENGTH) {
    return { eligible: false, creditDate: null };
  }

  for (let i = 1; i < STREAK_LENGTH; i++) {
    const diff = toUTCDate(uniqueSorted[i - 1]) - toUTCDate(uniqueSorted[i]);
    if (diff !== ONE_DAY_MS) {
      return { eligible: false, creditDate: null };
    }
  }

  return { eligible: true, creditDate: todayISO };
}

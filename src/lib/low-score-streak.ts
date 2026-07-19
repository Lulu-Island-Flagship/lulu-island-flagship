/**
 * v8.3 E5 (auditoría 2026-07-18) — causal documentable de "score < 50 por 3
 * semanas consecutivas".
 *
 * Función pura, testeable, sin acceso a base de datos. El caller
 * (src/app/api/cron/weekly-scores/route.ts) le pasa el score de la semana
 * recién calculada + las últimas semanas anteriores (en orden, la más
 * reciente primero) y esta función decide si la racha llegó a 3+ semanas
 * consecutivas por debajo de 50.
 *
 * Solo DOCUMENTA -- nunca decide una acción (suspensión, despido, etc.).
 * Eso sigue siendo decisión humana (invariante B.2.23); esta función solo
 * le dice al caller si debe crear el registro visible al admin.
 */

export interface WeeklyScoreRecord {
  weekStart: string; // YYYY-MM-DD
  totalScore: number;
}

export interface LowScoreStreakResult {
  isStreak: boolean;
  consecutiveWeeksBelow50: number;
  /** Semanas que componen la racha, de la más antigua a la más reciente. */
  streakWeeks: WeeklyScoreRecord[];
}

const LOW_SCORE_THRESHOLD = 50;
const STREAK_LENGTH_REQUIRED = 3;

/**
 * @param currentWeek Score de la semana que se acaba de calcular.
 * @param priorWeeksDescending Semanas anteriores, ORDENADAS de la más
 *   reciente a la más antigua (ej. [semana-1, semana-2, ...]). No hace
 *   falta pasar más de STREAK_LENGTH_REQUIRED - 1 semanas.
 */
export function evaluateLowScoreStreak(
  currentWeek: WeeklyScoreRecord,
  priorWeeksDescending: WeeklyScoreRecord[]
): LowScoreStreakResult {
  const chain = [currentWeek, ...priorWeeksDescending];

  let consecutive = 0;
  for (const week of chain) {
    if (week.totalScore < LOW_SCORE_THRESHOLD) {
      consecutive++;
    } else {
      break;
    }
  }

  if (consecutive < STREAK_LENGTH_REQUIRED) {
    return { isStreak: false, consecutiveWeeksBelow50: consecutive, streakWeeks: [] };
  }

  const streakWeeks = chain.slice(0, consecutive).reverse(); // más antigua primero

  return {
    isStreak: true,
    consecutiveWeeksBelow50: consecutive,
    streakWeeks,
  };
}

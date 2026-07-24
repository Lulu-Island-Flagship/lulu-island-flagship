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
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

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

  // Fix Kimi-M4 (auditoría externa Kimi Code, 2026-07-21, verificado y
  // confirmado real): esta función contaba "consecutivas" solo por
  // POSICIÓN en el arreglo, sin verificar que las semanas realmente estén
  // separadas por 7 días exactos. El caller (weekly-scores/route.ts) trae
  // las últimas N filas EXISTENTES de employee_scores -- si al empleado le
  // falta una semana (de baja, cron que no corrió esa semana, etc.), las
  // filas disponibles pueden tener huecos de calendario y aun así
  // contarse como "3 semanas consecutivas por debajo de 50", documentando
  // una racha que en realidad tuvo una interrupción.
  let consecutive = 0;
  for (let i = 0; i < chain.length; i++) {
    const week = chain[i];
    if (week.totalScore >= LOW_SCORE_THRESHOLD) {
      break;
    }
    if (i > 0) {
      const prevWeekStart = new Date(`${chain[i - 1].weekStart}T00:00:00Z`).getTime();
      const thisWeekStart = new Date(`${week.weekStart}T00:00:00Z`).getTime();
      if (prevWeekStart - thisWeekStart !== WEEK_MS) {
        break; // hueco de calendario: la racha se interrumpe aquí
      }
    }
    consecutive++;
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

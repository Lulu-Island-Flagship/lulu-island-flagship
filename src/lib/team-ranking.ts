/**
 * v8.3 E8 (D.8.10, B.2.21) — Ranking semanal de EQUIPOS. Regla dura B.2.21:
 * "Prohibido el ranking individual de empleados. Solo equipos, solo Top 3,
 * semanal." Este módulo debe ser estructuralmente incapaz de exponer datos
 * por empleado individual — no basta con "no mostrarlo en la UI".
 *
 * Defensa en profundidad (mismo patrón que positioning-coherence.ts /
 * pipa-validator.ts / bondedPolicyFlagActive fail-closed):
 *   1. Capa de tipos: `TeamWeeklyScoreInput` y `TeamRankingEntry` solo
 *      declaran campos de equipo. No existe un campo `employeeId` en ningún
 *      tipo de este módulo — literalmente no se puede escribir código
 *      TypeScript que lea un id de empleado desde estos tipos.
 *   2. Capa de runtime: como TypeScript es estructural (un valor con
 *      propiedades extra pasado por variable no lo rechaza el compilador),
 *      `getTop3Teams` escanea cada score recibido con
 *      `assertNoIndividualIdentifier` y LANZA si detecta cualquier clave que
 *      luzca a identificador individual (employee, empleado, worker, staff,
 *      SIN, person id, etc.), en cualquier nivel de anidación. Esto es lo
 *      que el test de "defensa en profundidad" verifica explícitamente.
 *   3. Capa de salida: la función SIEMPRE recorta a Top 3 (nunca expone
 *      posiciones inferiores — criterio de aceptación E8 explícito) y el
 *      objeto de salida solo contiene teamId/teamName/compositeScore/rank.
 *
 * Los pesos (spec E8 punto 10, literal): eficiencia 40% + calidad 30% +
 * puntualidad 20% + comercial 10%.
 */

export interface TeamWeeklyScoreInput {
  teamId: string;
  teamName: string;
  weekStart: string; // ISO date (lunes)
  efficiencyScore: number; // 0-100
  qualityScore: number; // 0-100
  punctualityScore: number; // 0-100
  commercialScore: number; // 0-100
}

export interface TeamRankingEntry {
  rank: 1 | 2 | 3;
  teamId: string;
  teamName: string;
  compositeScore: number;
}

const WEIGHTS = {
  efficiency: 0.4,
  quality: 0.3,
  punctuality: 0.2,
  commercial: 0.1,
} as const;

const TOP_N = 3;

/**
 * Patrón de claves prohibidas: cualquier variante de "identificador
 * individual" en español o inglés. Amplio a propósito — en caso de duda,
 * bloquea (fail-closed, mismo criterio que B.2.25 en positioning-coherence).
 */
const FORBIDDEN_KEY_PATTERN =
  /employee|empleado|worker|trabajador|staff|personal_?id|person_?id|\bsin\b|social_?insurance|ssn|user_?id|individual/i;

/**
 * Escanea recursivamente un valor (objeto/array) en busca de claves que
 * parezcan identificar a una persona individual. Lanza Error si encuentra
 * una — nunca devuelve un booleano silencioso, porque este es el último
 * cortafuegos antes de que un dato individual entre al cálculo de ranking.
 */
export function assertNoIndividualIdentifier(value: unknown, path = "root"): void {
  if (value === null || value === undefined) return;

  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoIndividualIdentifier(item, `${path}[${i}]`));
    return;
  }

  if (typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEY_PATTERN.test(key)) {
        throw new Error(
          `B.2.21 violado: la clave '${path}.${key}' parece un identificador individual. ` +
            `Prohibido el ranking individual de empleados — solo equipos, solo Top 3, semanal.`
        );
      }
      assertNoIndividualIdentifier((value as Record<string, unknown>)[key], `${path}.${key}`);
    }
    return;
  }
}

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, n));
}

/** Composite ponderado (spec literal E8.10): eficiencia 40 + calidad 30 + puntualidad 20 + comercial 10. */
export function computeCompositeScore(score: TeamWeeklyScoreInput): number {
  const composite =
    clampScore(score.efficiencyScore) * WEIGHTS.efficiency +
    clampScore(score.qualityScore) * WEIGHTS.quality +
    clampScore(score.punctualityScore) * WEIGHTS.punctuality +
    clampScore(score.commercialScore) * WEIGHTS.commercial;
  return Math.round(composite * 100) / 100;
}

/**
 * Top 3 semanal de EQUIPOS, ordenado descendente. Nunca devuelve más de 3
 * entradas (criterio de aceptación E8: "la API no expone posiciones
 * inferiores"). Desempate alfabético por nombre de equipo, determinista.
 */
export function getTop3Teams(scores: TeamWeeklyScoreInput[]): TeamRankingEntry[] {
  scores.forEach((s) => assertNoIndividualIdentifier(s));

  return scores
    .map((s) => ({
      teamId: s.teamId,
      teamName: s.teamName,
      compositeScore: computeCompositeScore(s),
    }))
    .sort((a, b) => b.compositeScore - a.compositeScore || a.teamName.localeCompare(b.teamName))
    .slice(0, TOP_N)
    .map((entry, i) => ({ rank: (i + 1) as 1 | 2 | 3, ...entry }));
}

/**
 * Reformatea filas ya agregadas por la RPC de base de datos (get_team_top3,
 * que ya trunca a 3 y ya agrega por equipo) a `TeamRankingEntry[]`. Vuelve a
 * pasar por `assertNoIndividualIdentifier` — defensa en profundidad también
 * en el camino que lee desde la base de datos, no solo en el cálculo puro.
 */
export function formatAggregatedRows(
  rows: { teamId: string; teamName: string; compositeScore: number }[]
): TeamRankingEntry[] {
  rows.forEach((r) => assertNoIndividualIdentifier(r));
  return rows.slice(0, TOP_N).map((r, i) => ({ rank: (i + 1) as 1 | 2 | 3, ...r }));
}

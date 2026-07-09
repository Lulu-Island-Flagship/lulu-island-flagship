/**
 * v8.3 E5 — Anti-gaming básico para votación entre pares (peer_votes).
 *
 * Dos riesgos concretos de manipulación que el sistema actual no detecta:
 *   1. Colusión recíproca: dos empleados se votan mutuamente alto cada semana
 *      para inflarse el score el uno al otro.
 *   2. Muestra insuficiente: si solo 1 compañero vota por alguien, ese único
 *      voto (amistoso u hostil) decide el 20% del score sin contrapeso.
 *
 * Funciones puras — no tocan la base de datos, solo evalúan un conjunto de
 * votos ya cargado.
 */

export interface PeerVote {
  voterEmployeeId: string;
  targetEmployeeId: string;
  rating: number; // 1-5
}

export interface ReciprocalPair {
  employeeA: string;
  employeeB: string;
  ratingAtoB: number;
  ratingBtoA: number;
}

/** Umbral de calificación "alta" para considerar sospechoso un par recíproco. */
export const HIGH_RATING_THRESHOLD = 4;

/**
 * Detecta pares de empleados que se calificaron mutuamente alto (>= umbral)
 * en la misma semana. No prueba colusión por sí solo (podría ser coincidencia
 * legítima entre dos buenos compañeros) — se marca para revisión, no se
 * descarta automáticamente el voto.
 */
export function detectReciprocalHighRatings(
  votes: PeerVote[],
  threshold: number = HIGH_RATING_THRESHOLD
): ReciprocalPair[] {
  const byPair = new Map<string, PeerVote>();
  for (const v of votes) {
    byPair.set(`${v.voterEmployeeId}->${v.targetEmployeeId}`, v);
  }

  const seen = new Set<string>();
  const pairs: ReciprocalPair[] = [];

  for (const v of votes) {
    const reverseKey = `${v.targetEmployeeId}->${v.voterEmployeeId}`;
    const reverse = byPair.get(reverseKey);
    if (!reverse) continue;

    const pairKey = [v.voterEmployeeId, v.targetEmployeeId].sort().join("|");
    if (seen.has(pairKey)) continue;
    seen.add(pairKey);

    if (v.rating >= threshold && reverse.rating >= threshold) {
      pairs.push({
        employeeA: v.voterEmployeeId,
        employeeB: v.targetEmployeeId,
        ratingAtoB: v.rating,
        ratingBtoA: reverse.rating,
      });
    }
  }

  return pairs;
}

/**
 * Cuenta votantes DISTINTOS que calificaron a un empleado dado. El score de
 * peer_votes solo debería contar con confianza plena si hay una muestra
 * mínima (evita que un solo voto, amigo u hostil, decida el 20% del score).
 */
export function countDistinctVoters(votes: PeerVote[], targetEmployeeId: string): number {
  const voters = new Set(
    votes.filter((v) => v.targetEmployeeId === targetEmployeeId).map((v) => v.voterEmployeeId)
  );
  return voters.size;
}

export const MIN_VOTERS_FOR_FULL_CONFIDENCE = 2;

/**
 * ¿El promedio de peer votes de este empleado tiene muestra suficiente para
 * contar con confianza plena? Si no, el llamador debería tratar el peer
 * score como neutral (ni castigo ni premio) en vez de confiar en 1 solo voto.
 */
export function hasSufficientVoterSample(
  votes: PeerVote[],
  targetEmployeeId: string,
  minVoters: number = MIN_VOTERS_FOR_FULL_CONFIDENCE
): boolean {
  return countDistinctVoters(votes, targetEmployeeId) >= minVoters;
}

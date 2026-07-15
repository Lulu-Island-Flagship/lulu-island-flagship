import { createHash } from "crypto";

/**
 * v8.3 E9.7 — Monitoreo legal dinámico. Funciones puras para el
 * health-check de "ceguera" y el hash-chain de logs inmutables usado por
 * el protocolo de brecha (E9.9 / E9.4 "logs inmutables con hash").
 *
 * `isFeedBlind` vive en pipeda.ts (se comparte el mismo umbral de 30 días
 * declarado en el plan para ambos puntos E9.7/E9.9). Este archivo se
 * enfoca en lo que es propio del monitoreo legal: frecuencias declaradas
 * y el encadenado de hash.
 */

export const FEED_FREQUENCY_DAYS: Record<"daily" | "weekly" | "monthly", number> = {
  daily: 1,
  weekly: 7,
  monthly: 30,
};

export type LegalFeedFrequency = keyof typeof FEED_FREQUENCY_DAYS;

/** ¿Este feed está "atrasado" según SU frecuencia declarada (distinto de
 * "ciego", que es el umbral duro de 30 días del plan)? Sirve para
 * priorizar cuáles revisar primero sin esperar a que se vuelvan ciegos. */
export function isFeedOverdueForFrequency(
  lastCheckedAt: Date | null,
  createdAt: Date,
  now: Date,
  frequency: LegalFeedFrequency
): boolean {
  const reference = lastCheckedAt ?? createdAt;
  const daysSince = (now.getTime() - reference.getTime()) / (1000 * 60 * 60 * 24);
  return daysSince > FEED_FREQUENCY_DAYS[frequency];
}

export interface HashChainInput {
  prevHash: string | null;
  content: string;
}

/** sha256(prevHash || content) -- cadena de hashes para detectar edición
 * retroactiva de un log que se supone inmutable (E9.4). `prevHash` es
 * cadena vacía para la primera fila de la cadena. */
export function computeRowHash({ prevHash, content }: HashChainInput): string {
  return createHash("sha256").update((prevHash ?? "") + content).digest("hex");
}

/** Verifica que una cadena de filas (en orden cronológico) no fue alterada:
 * recalcula cada hash a partir del hash anterior guardado y compara. */
export function verifyHashChain(
  rows: Array<{ prevHash: string | null; content: string; rowHash: string }>
): { valid: boolean; brokenAtIndex: number | null } {
  for (let i = 0; i < rows.length; i++) {
    const expected = computeRowHash({ prevHash: rows[i].prevHash, content: rows[i].content });
    if (expected !== rows[i].rowHash) {
      return { valid: false, brokenAtIndex: i };
    }
  }
  return { valid: true, brokenAtIndex: null };
}

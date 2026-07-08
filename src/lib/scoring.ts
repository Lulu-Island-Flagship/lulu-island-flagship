/**
 * Score de confianza progresivo del cliente (Módulo 1).
 *
 * Reglas del spec v8.2:
 *   - Base: 50
 *   - +20 por cada servicio completado sin disputa
 *   - -25 por cada disputa PERDIDA (no por cualquier disputa)
 *   - -25 por cada no-show
 *   - Rango: [-100, 100]
 */

export const CLIENT_SCORE_BASE = 50;
export const CLIENT_SCORE_PER_SERVICE = 20;
export const CLIENT_SCORE_PER_DISPUTE_LOST = -25;
export const CLIENT_SCORE_PER_NO_SHOW = -25;
export const CLIENT_SCORE_MIN = -100;
export const CLIENT_SCORE_MAX = 100;

export interface ClientScoreInputs {
  servicesCount: number;
  /** Disputas en las que la carga de la prueba recayó en Lulu (perdidas). */
  disputesLostCount: number;
  noShowCount: number;
}

export function calculateClientScore(inputs: ClientScoreInputs): number {
  const raw =
    CLIENT_SCORE_BASE +
    inputs.servicesCount * CLIENT_SCORE_PER_SERVICE +
    inputs.disputesLostCount * CLIENT_SCORE_PER_DISPUTE_LOST +
    inputs.noShowCount * CLIENT_SCORE_PER_NO_SHOW;

  return Math.max(CLIENT_SCORE_MIN, Math.min(CLIENT_SCORE_MAX, raw));
}

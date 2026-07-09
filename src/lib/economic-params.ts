/**
 * v8.3 E9 (B.3.2) — Parámetros económicos auto-actualizados.
 *
 * Criterio de aceptación literal: "Simular cambio de salario mínimo a
 * $18.65 → el sistema recalcula Day Rate mínimo, lista contratos afectados,
 * muestra impacto en margen y espera UN clic."
 *
 * Funciones puras: la detección de cambio y el cálculo de impacto no tocan
 * la base de datos. La aplicación (UN clic humano) sigue siendo un paso
 * separado y explícito — esta lib nunca aplica el cambio por sí sola.
 */

export interface MinimumWageChangeInput {
  currentMinimumWage: number;
  newMinimumWage: number;
  /** Day Rate mínimo actual, ya vigente */
  currentMinimumDayRate: number;
  /** horas estándar de un Day Rate para convertir salario/hora <-> Day Rate */
  standardDayHours: number;
}

export interface MinimumWageImpact {
  changed: boolean;
  deltaPerHour: number;
  deltaPercent: number;
  suggestedMinimumDayRate: number;
  dayRateDeltaDollars: number;
}

/**
 * Calcula el impacto de un cambio de salario mínimo sobre el Day Rate
 * mínimo. El nuevo Day Rate sugerido nunca puede quedar por debajo de
 * newMinimumWage * standardDayHours (piso legal).
 */
export function calculateMinimumWageImpact(input: MinimumWageChangeInput): MinimumWageImpact {
  const { currentMinimumWage, newMinimumWage, currentMinimumDayRate, standardDayHours } = input;

  const changed = newMinimumWage !== currentMinimumWage;
  const deltaPerHour = newMinimumWage - currentMinimumWage;
  const deltaPercent = currentMinimumWage > 0 ? (deltaPerHour / currentMinimumWage) * 100 : 0;

  const legalFloorDayRate = newMinimumWage * standardDayHours;
  const suggestedMinimumDayRate = Math.max(currentMinimumDayRate, legalFloorDayRate);
  const dayRateDeltaDollars = suggestedMinimumDayRate - currentMinimumDayRate;

  return {
    changed,
    deltaPerHour,
    deltaPercent,
    suggestedMinimumDayRate,
    dayRateDeltaDollars,
  };
}

export interface AffectedContract {
  contractId: string;
  currentDayRate: number;
}

export interface ContractImpact {
  contractId: string;
  currentDayRate: number;
  needsAdjustment: boolean;
  newDayRate: number;
}

/**
 * Lista contratos cuyo Day Rate actual queda por debajo del nuevo piso legal
 * y necesitan ajuste.
 */
export function listAffectedContracts(
  contracts: AffectedContract[],
  suggestedMinimumDayRate: number
): ContractImpact[] {
  return contracts.map((c) => ({
    contractId: c.contractId,
    currentDayRate: c.currentDayRate,
    needsAdjustment: c.currentDayRate < suggestedMinimumDayRate,
    newDayRate: Math.max(c.currentDayRate, suggestedMinimumDayRate),
  }));
}

// ------------------------------------------------------------
// Monitoreo legal: health-check de "ceguera" del feed (D.9.7)
// ------------------------------------------------------------

export const LEGAL_FEED_BLIND_DAYS = 30;

/** ¿El feed legal lleva demasiados días sin actualizar? ("el monitoreo está ciego") */
export function isLegalFeedBlind(
  lastUpdatedIso: string,
  nowIso: string,
  blindDays: number = LEGAL_FEED_BLIND_DAYS
): boolean {
  const last = new Date(lastUpdatedIso).getTime();
  const now = new Date(nowIso).getTime();
  const elapsedDays = (now - last) / (1000 * 60 * 60 * 24);
  return elapsedDays >= blindDays;
}

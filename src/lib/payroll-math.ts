/**
 * v8.4 — Shared payroll math helpers.
 *
 * These pure numeric functions are used by payroll-calculator.ts and
 * payroll-deductions.ts to avoid duplication. Extracted during the
 * unification of CPP/EI/WorkSafeBC/Vacation Pay calculation in Aug 2026.
 */

/** Clamp a value between lo and hi (inclusive). */
export function clamp(val: number, lo: number, hi: number): number {
  return Math.min(Math.max(val, lo), hi);
}

/**
 * How much of `cumulative` falls inside the band (bandLow, bandHigh].
 *
 * Used for calculating remaining room up to annual caps like YMPE,
 * maximum insurable earnings, and WorkSafeBC assessable ceiling.
 */
export function cumulativeInBand(
  cumulativeCents: number,
  bandLowCents: number,
  bandHighCents: number
): number {
  return clamp(cumulativeCents, bandLowCents, bandHighCents) - bandLowCents;
}

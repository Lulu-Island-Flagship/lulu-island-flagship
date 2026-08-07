// ─── Constantes de dominio de nómina ──────────────────────────
// v8.3 H5 (auditoría 2026-08-06): PAY_PERIODS_PER_YEAR se extrajo
// de payroll-deductions.ts para romper el acoplamiento compliance →
// payroll. Las constantes de dominio contable (períodos de pago,
// frecuencia) pertenecen aquí; las tasas legales (CPP, EI) siguen
// en payroll-deductions.ts (fuente de verdad versionada).
//
// compliance-resolver.ts ahora recibe payPeriodsPerYear como
// parámetro opcional en CppCalculationInput (default: esta constante).

/** Períodos de pago por año: semi-mensual (invariante B.1), NUNCA 26/27. */
export const PAY_PERIODS_PER_YEAR = 24;

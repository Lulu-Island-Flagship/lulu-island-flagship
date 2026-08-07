/**
 * v8.3 E9 — Deducciones de nómina canadienses (CPP, CPP2, EI, WorkSafeBC,
 * Vacation Pay BC ESA). Funciones puras: reciben el bruto del período y el
 * acumulado del año (YTD), devuelven la deducción del período y el nuevo YTD.
 *
 * Tasas oficiales 2026 (fuentes: CRA, Canada Employment Insurance Commission,
 * WorkSafeBC, BC Employment Standards Act). Deben revisarse y actualizarse
 * cada enero — ver isLegalFeedBlind() en economic-params.ts para la alerta de
 * "feed legal ciego" que cubre justamente este tipo de tasas.
 *
 * LIMITACIÓN EXPLÍCITA: esto NO calcula retención de impuesto federal/provincial
 * (income tax). Esa tabla (CRA T4127 / PDOC) depende de créditos personales,
 * provincia, TD1, etc., y no se puede aproximar de forma confiable sin esos
 * datos por empleado. Para nómina oficial, usar PDOC de CRA o un proveedor
 * certificado (ej. QBO Payroll) — este módulo cubre CPP/CPP2/EI/WorkSafeBC/
 * Vacation Pay para que el ciclo interno tenga el desglose completo salvo esa
 * pieza, que se deja explícitamente en cero/fuera de alcance.
 */

/**
 * v8.3 fix auditoría E9 (fiscal): el ciclo de nómina real (ver
 * payroll-cycle.ts, invariante B.1) es SEMI-MENSUAL (día 1-15 / día 16-fin
 * de mes), NO quincenal cada 14 días. Un ciclo semi-mensual tiene SIEMPRE
 * exactamente 24 períodos por año calendario -- a diferencia de un ciclo
 * quincenal real (cada 14 días desde una fecha ancla), que sí varía entre
 * 26 y 27 períodos según el año. Como este sistema nunca usa el ciclo de
 * 14 días, ese caso de 26/27 no aplica aquí; el valor correcto y estable
 * es 24, no 26. Antes de este fix, usar 26 subestimaba la exención básica
 * de CPP prorrateada por período (3500/26=$134.62 vs 3500/24=$145.83),
 * causando una retención de CPP ligeramente MAYOR a la que exige CRA en
 * cada período (sobre-retención, no sub-retención -- pero igual es un
 * error de cálculo que debe corregirse).
 */
import { PAY_PERIODS_PER_YEAR } from "./payroll-constants";
export { PAY_PERIODS_PER_YEAR };

// ---- CPP 2026 (CRA) ----
export const CPP_RATE_2026 = 0.0595;
export const CPP_BASIC_EXEMPTION_ANNUAL_2026 = 3500;
export const CPP_YMPE_2026 = 74600; // Year's Maximum Pensionable Earnings
export const CPP2_RATE_2026 = 0.04;
export const CPP_YAMPE_2026 = 85000; // Year's Additional Maximum Pensionable Earnings

// ---- EI 2026 (Canada Employment Insurance Commission) ----
export const EI_EMPLOYEE_RATE_2026 = 0.0163; // $1.63 por $100 asegurable
export const EI_EMPLOYER_MULTIPLIER = 1.4;
export const EI_MAX_INSURABLE_2026 = 68900;

// ---- WorkSafeBC 2026 ----
// Tasa base promedio; la tasa real depende de la unidad de clasificación de
// la empresa y debe confirmarse en el aviso anual de WorkSafeBC. Solo la paga
// el empleador (no es una deducción del empleado).
export const WORKSAFEBC_AVG_BASE_RATE_2026 = 0.0155; // $1.55 por $100
export const WORKSAFEBC_MAX_ASSESSABLE_EARNINGS_2026 = 127500; // tope anual por trabajador

// ---- BC ESA Vacation Pay (Employment Standards Act, Part 7 s.58) ----
export const VACATION_PAY_RATE_UNDER_5Y = 0.04;
export const VACATION_PAY_RATE_5Y_PLUS = 0.06;
export const VACATION_PAY_YEARS_THRESHOLD = 5;

function clamp(val: number, lo: number, hi: number): number {
  return Math.min(Math.max(val, lo), hi);
}

/** Cuánto de `cumulative` cae dentro de la banda (bandLow, bandHigh]. */
function cumulativeInBand(cumulativeCents: number, bandLowCents: number, bandHighCents: number): number {
  return clamp(cumulativeCents, bandLowCents, bandHighCents) - bandLowCents;
}

// ------------------------------------------------------------
// CPP / CPP2
// ------------------------------------------------------------

export interface CppInput {
  grossCents: number;
  /** Acumulado de ganancias pensionables del empleado en el año, ANTES de este período. */
  ytdPensionableCents: number;
  payPeriodsPerYear?: number;
}

export interface CppResult {
  baseContributionCents: number;
  cpp2ContributionCents: number;
  totalContributionCents: number;
  ytdPensionableAfterCents: number;
}

/** CPP base (hasta YMPE) + CPP2 (entre YMPE y YAMPE), con exención básica prorrateada por período. */
export function calculateCppContribution(input: CppInput): CppResult {
  const periods = input.payPeriodsPerYear ?? PAY_PERIODS_PER_YEAR;
  const exemptionPerPeriodCents = Math.round((CPP_BASIC_EXEMPTION_ANNUAL_2026 * 100) / periods);
  const ympeCents = CPP_YMPE_2026 * 100;
  const yampeCents = CPP_YAMPE_2026 * 100;

  const ytdBefore = Math.max(0, input.ytdPensionableCents);
  const ytdAfter = ytdBefore + input.grossCents;

  // Ganancias pensionables base: gross menos exención, acotadas por el
  // espacio restante hasta el YMPE según el acumulado del año.
  const roomToYmpe = cumulativeInBand(ytdAfter, 0, ympeCents) - cumulativeInBand(ytdBefore, 0, ympeCents);
  const grossLessExemption = Math.max(0, input.grossCents - exemptionPerPeriodCents);
  const basePensionableThisPeriod = Math.min(grossLessExemption, Math.max(0, roomToYmpe));
  const baseContributionCents = Math.round(basePensionableThisPeriod * CPP_RATE_2026);

  // CPP2: ganancias entre YMPE y YAMPE, sin exención adicional.
  const cpp2PensionableThisPeriod =
    cumulativeInBand(ytdAfter, ympeCents, yampeCents) - cumulativeInBand(ytdBefore, ympeCents, yampeCents);
  const cpp2ContributionCents = Math.round(Math.max(0, cpp2PensionableThisPeriod) * CPP2_RATE_2026);

  return {
    baseContributionCents,
    cpp2ContributionCents,
    totalContributionCents: baseContributionCents + cpp2ContributionCents,
    ytdPensionableAfterCents: ytdAfter,
  };
}

// ------------------------------------------------------------
// EI
// ------------------------------------------------------------

export interface EiInput {
  grossCents: number;
  /** Acumulado de ganancias asegurables del empleado en el año, ANTES de este período. */
  ytdInsurableCents: number;
}

export interface EiResult {
  employeeCents: number;
  employerCents: number;
  ytdInsurableAfterCents: number;
}

export function calculateEiPremium(input: EiInput): EiResult {
  const maxInsurableCents = EI_MAX_INSURABLE_2026 * 100;
  const ytdBefore = Math.max(0, input.ytdInsurableCents);
  const ytdAfter = ytdBefore + input.grossCents;

  const insurableThisPeriod =
    cumulativeInBand(ytdAfter, 0, maxInsurableCents) - cumulativeInBand(ytdBefore, 0, maxInsurableCents);

  const employeeCents = Math.round(Math.max(0, insurableThisPeriod) * EI_EMPLOYEE_RATE_2026);
  const employerCents = Math.round(employeeCents * EI_EMPLOYER_MULTIPLIER);

  return { employeeCents, employerCents, ytdInsurableAfterCents: ytdAfter };
}

// ------------------------------------------------------------
// WorkSafeBC (solo empleador)
// ------------------------------------------------------------

export interface WorkSafeBcInput {
  grossCents: number;
  ytdAssessableCents: number;
  rate?: number; // fracción, ej. 0.0155
}

export interface WorkSafeBcResult {
  employerCents: number;
  ytdAssessableAfterCents: number;
}

export function calculateWorkSafeBcPremium(input: WorkSafeBcInput): WorkSafeBcResult {
  const rate = input.rate ?? WORKSAFEBC_AVG_BASE_RATE_2026;
  const maxAssessableCents = WORKSAFEBC_MAX_ASSESSABLE_EARNINGS_2026 * 100;
  const ytdBefore = Math.max(0, input.ytdAssessableCents);
  const ytdAfter = ytdBefore + input.grossCents;

  const assessableThisPeriod =
    cumulativeInBand(ytdAfter, 0, maxAssessableCents) - cumulativeInBand(ytdBefore, 0, maxAssessableCents);

  const employerCents = Math.round(Math.max(0, assessableThisPeriod) * rate);

  return { employerCents, ytdAssessableAfterCents: ytdAfter };
}

// ------------------------------------------------------------
// Vacation Pay (BC ESA)
// ------------------------------------------------------------

/** 4% con <5 años de antigüedad continua, 6% con 5+ años (BC ESA Parte 7 s.58). */
export function getVacationPayRate(yearsOfService: number): number {
  return yearsOfService >= VACATION_PAY_YEARS_THRESHOLD ? VACATION_PAY_RATE_5Y_PLUS : VACATION_PAY_RATE_UNDER_5Y;
}

export function calculateVacationPayAccrual(grossCents: number, yearsOfService: number): number {
  return Math.round(grossCents * getVacationPayRate(yearsOfService));
}

// ------------------------------------------------------------
// Desglose completo de un período para un empleado
// ------------------------------------------------------------

export interface PayrollDeductionsInput {
  grossCents: number;
  yearsOfService: number;
  ytdPensionableCents: number;
  ytdInsurableCents: number;
  ytdAssessableCents: number;
  payPeriodsPerYear?: number;
  workSafeBcRate?: number;
}

export interface PayrollDeductionsResult {
  grossCents: number;
  cpp: CppResult;
  ei: EiResult;
  workSafeBc: WorkSafeBcResult;
  vacationPayAccrualCents: number;
  /** Deducciones del EMPLEADO (reducen el neto): CPP + CPP2 + EI empleado. Impuesto NO incluido (ver nota arriba). */
  employeeDeductionsCents: number;
  /** Neto estimado = bruto - deducciones del empleado. NO es el neto oficial (falta impuesto). */
  estimatedNetCents: number;
  /** Costo del empleador además del bruto: CPP+CPP2 patronal, EI patronal, WorkSafeBC. */
  employerCostCents: number;
}

export function calculatePayrollDeductions(input: PayrollDeductionsInput): PayrollDeductionsResult {
  const cpp = calculateCppContribution({
    grossCents: input.grossCents,
    ytdPensionableCents: input.ytdPensionableCents,
    payPeriodsPerYear: input.payPeriodsPerYear,
  });
  const ei = calculateEiPremium({
    grossCents: input.grossCents,
    ytdInsurableCents: input.ytdInsurableCents,
  });
  const workSafeBc = calculateWorkSafeBcPremium({
    grossCents: input.grossCents,
    ytdAssessableCents: input.ytdAssessableCents,
    rate: input.workSafeBcRate,
  });
  const vacationPayAccrualCents = calculateVacationPayAccrual(input.grossCents, input.yearsOfService);

  // CPP/CPP2 se pagan en partes iguales entre empleado y empleador.
  const employeeDeductionsCents = cpp.totalContributionCents + ei.employeeCents;
  const employerCostCents = cpp.totalContributionCents + ei.employerCents + workSafeBc.employerCents;

  return {
    grossCents: input.grossCents,
    cpp,
    ei,
    workSafeBc,
    vacationPayAccrualCents,
    employeeDeductionsCents,
    estimatedNetCents: input.grossCents - employeeDeductionsCents,
    employerCostCents,
  };
}

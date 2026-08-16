import { applyPercentRoundHalfUp } from "./money";

/**
 * DEPRECATED: este módulo es un wrapper de compatibilidad. Todo cálculo nuevo
 * debe ir en payroll-calculator.ts + compliance-resolver.ts.
 *
 * v8.4 — Unificación de cálculo de CPP, EI, WorkSafeBC y Vacation Pay.
 * Las funciones de cálculo delegan a compliance-resolver.ts (fuente canónica
 * con parámetros configurables desde BD). Solo WorkSafeBC conserva lógica
 * local porque usa tasa por defecto distinta y acepta rate personalizada.
 *
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
 *
 * v8.3 fix auditoría E9 (fiscal): el ciclo de nómina real (ver
 * payroll-cycle.ts, invariante B.1) es SEMI-MENSUAL (día 1-15 / día 16-fin
 * de mes), NO quincenal cada 14 días. Un ciclo semi-mensual tiene SIEMPRE
 * exactamente 24 períodos por año calendario.
 */

import { PAY_PERIODS_PER_YEAR } from "./payroll-constants";
export { PAY_PERIODS_PER_YEAR };

import {
  calculateCPP,
  calculateEI,
  calculateEmployerEI,
  calculateVacationAccrual,
  type CppCalculationInput,
  type EiCalculationInput,
  type EmployerEiInput,
} from "./compliance-resolver";
import { cumulativeInBand } from "./payroll-math";

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

/**
 * CPP base (hasta YMPE) + CPP2 (entre YMPE y YAMPE).
 *
 * Delega el cálculo base a compliance-resolver.ts (calculateCPP) que resuelve
 * tasa, exención y tope desde los seed data versionados. CPP2 se calcula
 * localmente porque el compliance-resolver aún no tiene soporte para CPP2.
 */
export function calculateCppContribution(input: CppInput): CppResult {
  const periods = input.payPeriodsPerYear ?? PAY_PERIODS_PER_YEAR;

  // Base CPP delegado a compliance-resolver
  const cppInput: CppCalculationInput = {
    grossPayCents: input.grossCents,
    periodStart: new Date(),
    ytdPensionableCents: input.ytdPensionableCents,
    payPeriodsPerYear: periods,
  };
  const baseResult = calculateCPP(cppInput);

  const ytdBefore = Math.max(0, input.ytdPensionableCents);
  const ytdAfter = ytdBefore + input.grossCents;
  const ympeCents = baseResult.ympEcents; // from compliance-resolver seed
  const yampeCents = CPP_YAMPE_2026 * 100;

  // CPP2: ganancias entre YMPE y YAMPE, sin exención adicional.
  const cpp2PensionableThisPeriod =
    cumulativeInBand(ytdAfter, ympeCents, yampeCents) -
    cumulativeInBand(ytdBefore, ympeCents, yampeCents);
  const cpp2ContributionCents = Number(applyPercentRoundHalfUp(BigInt(Math.max(0, cpp2PensionableThisPeriod)), CPP2_RATE_2026 * 100));

  return {
    baseContributionCents: baseResult.employeeCents,
    cpp2ContributionCents,
    totalContributionCents: baseResult.employeeCents + cpp2ContributionCents,
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

/**
 * Calcula la prima EI del empleado + empleador.
 *
 * Delega a compliance-resolver.ts (calculateEI + calculateEmployerEI) que
 * resuelve tasa y tope asegurable desde los seed data versionados.
 */
export function calculateEiPremium(input: EiInput): EiResult {
  const eiInput: EiCalculationInput = {
    grossPayCents: input.grossCents,
    periodStart: new Date(),
    ytdInsurableCents: input.ytdInsurableCents,
  };

  const eiResult = calculateEI(eiInput);

  const employerInput: EmployerEiInput = {
    grossPayCents: input.grossCents,
    periodStart: new Date(),
    ytdInsurableCents: input.ytdInsurableCents,
  };
  const employerCents = calculateEmployerEI(employerInput);

  return {
    employeeCents: eiResult.employeeCents,
    employerCents,
    ytdInsurableAfterCents: eiResult.ytdInsurableAfterCents,
  };
}

// ------------------------------------------------------------
// WorkSafeBC (solo empleador)
// ------------------------------------------------------------

export interface WorkSafeBcInput {
  grossCents: number;
  /** Acumulado de ganancias evaluables del empleado en el año, ANTES de este período. */
  ytdAssessableCents: number;
  /** Tasa personalizada por unidad de clasificación (dólares por $1 de nómina).
   *  Si no se provee, usa WORKSAFEBC_AVG_BASE_RATE_2026. */
  rate?: number;
}

export interface WorkSafeBcResult {
  employerCents: number;
  ytdAssessableAfterCents: number;
}

/**
 * Calcula la prima de WorkSafeBC (solo empleador) con tope anual.
 *
 * Conserva lógica local porque accepta tasa personalizada (rate) y usa un
 * default distinto al del compliance-resolver (0.0155 vs class_rate 2.15).
 * El compliance-resolver's getWorksafeBCPremium es una función más simple
 * que no maneja YTD caps ni tasas custom.
 */
export function calculateWorkSafeBcPremium(input: WorkSafeBcInput): WorkSafeBcResult {
  const rate = input.rate ?? WORKSAFEBC_AVG_BASE_RATE_2026;
  const maxAssessableCents = WORKSAFEBC_MAX_ASSESSABLE_EARNINGS_2026 * 100;
  const ytdBefore = Math.max(0, input.ytdAssessableCents);
  const ytdAfter = ytdBefore + input.grossCents;

  const assessableThisPeriod =
    cumulativeInBand(ytdAfter, 0, maxAssessableCents) -
    cumulativeInBand(ytdBefore, 0, maxAssessableCents);

  const employerCents = Number(applyPercentRoundHalfUp(BigInt(Math.max(0, assessableThisPeriod)), rate * 100));

  return { employerCents, ytdAssessableAfterCents: ytdAfter };
}

// ------------------------------------------------------------
// Vacation Pay (BC ESA)
// ------------------------------------------------------------

/** 4% con <5 años de antigüedad continua, 6% con 5+ años (BC ESA Parte 7 s.58). */
export function getVacationPayRate(yearsOfService: number): number {
  return yearsOfService >= VACATION_PAY_YEARS_THRESHOLD ? VACATION_PAY_RATE_5Y_PLUS : VACATION_PAY_RATE_UNDER_5Y;
}

/**
 * Calcula la acumulación de Vacation Pay delegando a compliance-resolver.ts.
 *
 * El compliance-resolver resuelve las tasas (4% / 6%) desde los seed data
 * versionados, que coinciden con las constantes locales de BC ESA.
 */
export function calculateVacationPayAccrual(grossCents: number, yearsOfService: number): number {
  return calculateVacationAccrual(grossCents, yearsOfService, new Date());
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

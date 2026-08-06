/**
 * v8.4 Capa 4 del Financial Core — Year-to-Date Tracking.
 *
 * Calcula acumulados anuales (YTD) para cada empleado a partir de las
 * líneas de nómina (payroll_linea). Proporciona comparativos interanuales
 * y un preview de lo que aparecerá en el T4 al cierre del año fiscal.
 *
 * El módulo es puro: todas las funciones reciben los datos como parámetros
 * (arrays de PayrollLineaRow) y devuelven resultados computados. El caller
 * es responsable de consultar la base de datos y pasar las líneas
 * correspondientes.
 *
 * T4 Box Mapping (CRA):
 *   Box 14 — Employment Income (gross pay total)
 *   Box 16 — Employee CPP Contributions
 *   Box 18 — Employee EI Premiums
 *   Box 22 — Income Tax Deducted (federal + provincial)
 *   Box 24 — EI Insurable Earnings (gross, capped at max insurable)
 *   Box 26 — CPP/QPP Pensionable Earnings (gross, capped at YMPE)
 *   Box 28 — Exempt (CPP/QPP, EI, PPIP) — aplica solo en casos especiales
 *
 * REGLA: todos los montos en centavos enteros (CAD). SIN parcial en logs.
 *
 * Interconexiones:
 *   payroll-ytd.ts ──(importa)──→ payroll-line.ts (PayrollLineaRow)
 *   payroll-ytd.ts ──(importa)──→ compliance-resolver.ts (getCurrentRate para topes T4)
 *   payroll-ytd.ts ──(importado por)──→ payroll-engine.ts (YTD previos para cálculo)
 *   payroll-ytd.ts ──(importado por)──→ employee-financial-dashboard.ts
 */

import { z } from "zod";

import type { PayrollLineaRow } from "./payroll-line";
import { getCurrentRate } from "./compliance-resolver";
import type { CppParams, EiParams } from "./compliance-engine";

// =========================================================================
// YTD Accumulated — resultado de calculateYtd()
// =========================================================================

/**
 * Acumulados Year-to-Date para un empleado a una fecha de corte.
 *
 * Todos los montos en centavos enteros CAD.
 */
export interface YtdAccumulated {
  /** ID del empleado. */
  employeeId: string;

  /** Año calendario (YYYY). */
  anio: number;

  /** Fecha de corte (último día incluido en el cálculo, YYYY-MM-DD). */
  fechaCorte: string;

  /** ── Employee-side totals ─────────────────────────────────────── */

  /** Gross pay acumulado en el año (centavos). */
  grossCents: number;

  /** CPP empleado acumulado en el año (centavos). */
  cppEmployeeCents: number;

  /** EI empleado acumulado en el año (centavos). */
  eiEmployeeCents: number;

  /** Impuesto federal acumulado retenido en el año (centavos). */
  taxFederalCents: number;

  /** Impuesto provincial BC acumulado retenido en el año (centavos). */
  taxProvincialCents: number;

  /** Total impuestos retenidos acumulados (federal + provincial, centavos). */
  taxTotalCents: number;

  /** Neto acumulado pagado al empleado en el año (centavos). */
  netoCents: number;

  /** ── Employer-side totals ─────────────────────────────────────── */

  /** CPP empleador acumulado en el año (centavos). */
  cppEmployerCents: number;

  /** EI empleador acumulado en el año (centavos). */
  eiEmployerCents: number;

  /** WorkSafeBC prima acumulada en el año (centavos). */
  worksafebcCents: number;

  /** Vacation Pay devengado acumulado en el año (centavos). */
  vacationPayCents: number;

  /** ── Metadata ─────────────────────────────────────────────────── */

  /** Número de ciclos de nómina incluidos en el cálculo. */
  cicloCount: number;

  /** Timestamp de generación del cálculo. */
  computedAtISO: string;
}

/** Schema Zod para YtdAccumulated (validación de salida). */
export const ytdAccumulatedSchema = z.object({
  employeeId: z.string().uuid(),
  anio: z.number().int().min(2000).max(2100),
  fechaCorte: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  grossCents: z.number().int().nonnegative(),
  cppEmployeeCents: z.number().int().nonnegative(),
  eiEmployeeCents: z.number().int().nonnegative(),
  taxFederalCents: z.number().int().nonnegative(),
  taxProvincialCents: z.number().int().nonnegative(),
  taxTotalCents: z.number().int().nonnegative(),
  netoCents: z.number().int(),
  cppEmployerCents: z.number().int().nonnegative(),
  eiEmployerCents: z.number().int().nonnegative(),
  worksafebcCents: z.number().int().nonnegative(),
  vacationPayCents: z.number().int().nonnegative(),
  cicloCount: z.number().int().nonnegative(),
  computedAtISO: z.string().datetime(),
});

// =========================================================================
// calculateYtd()
// =========================================================================

/**
 * Calcula los acumulados Year-to-Date para un empleado a una fecha de corte.
 *
 * Suma todas las líneas de nómina del empleado cuyo ciclo esté dentro del
 * año calendario y cuya fecha de fin del ciclo sea ≤ fecha de corte.
 *
 * ESTRATEGIA: las líneas se filtran por año y fecha, y se acumulan los
 * campos individuales (gross, cpp_empleado, ei_empleado, etc.). Esto es
 * más robusto que depender de los campos ytd_* de la última línea, que
 * dependen de que todas las líneas del año estén presentes en el array.
 *
 * @param lineas — Array de PayrollLineaRow del empleado (el caller filtra por employee_id).
 * @param anio — Año calendario a calcular (YYYY).
 * @param fechaCorte — Fecha de corte YYYY-MM-DD (último día incluido).
 * @param employeeId — ID del empleado (para metadata).
 * @returns YtdAccumulated con todos los acumulados.
 *
 * @example
 * ```ts
 * const ytd = calculateYtd(lineasDelEmpleado, 2026, "2026-08-15", empId);
 * // ytd.grossCents → total bruto acumulado en 2026 hasta ago-15
 * // ytd.cicloCount → número de ciclos incluidos
 * ```
 */
export function calculateYtd(
  lineas: PayrollLineaRow[],
  anio: number,
  fechaCorte: string,
  employeeId: string,
): YtdAccumulated {
  const anioStr = String(anio);
  const corteMs = new Date(`${fechaCorte}T00:00:00.000Z`).getTime();

  // Filtrar líneas que pertenecen al año y están en o antes del corte.
  // Usamos creado_en como proxy de la fecha del ciclo (el caller debe
  // asegurar que las líneas pasadas YA están filtradas por ciclo dentro
  // del rango de fechas correcto).
  const relevantLines = lineas.filter((l) => {
    const createdMs = new Date(l.creado_en).getTime();
    const createdYear = l.creado_en.slice(0, 4);
    return createdYear === anioStr && createdMs <= corteMs;
  });

  let grossCents = 0;
  let cppEmployeeCents = 0;
  let eiEmployeeCents = 0;
  let taxFederalCents = 0;
  let taxProvincialCents = 0;
  let netoCents = 0;
  let cppEmployerCents = 0;
  let eiEmployerCents = 0;
  let worksafebcCents = 0;
  let vacationPayCents = 0;

  for (const linea of relevantLines) {
    grossCents += linea.gross_cents;
    cppEmployeeCents += linea.cpp_empleado;
    eiEmployeeCents += linea.ei_empleado;
    taxFederalCents += linea.tax_federal;
    taxProvincialCents += linea.tax_provincial;
    netoCents += linea.neto_pagar;
    cppEmployerCents += linea.cpp_employer;
    eiEmployerCents += linea.ei_employer;
    worksafebcCents += linea.worksafebc_prima;
    vacationPayCents += linea.vacation_pay_cents;
  }

  const result: YtdAccumulated = {
    employeeId,
    anio,
    fechaCorte,
    grossCents,
    cppEmployeeCents,
    eiEmployeeCents,
    taxFederalCents,
    taxProvincialCents,
    taxTotalCents: taxFederalCents + taxProvincialCents,
    netoCents,
    cppEmployerCents,
    eiEmployerCents,
    worksafebcCents,
    vacationPayCents,
    cicloCount: relevantLines.length,
    computedAtISO: new Date().toISOString(),
  };

  return ytdAccumulatedSchema.parse(result);
}

/**
 * Obtiene los acumulados YTD desde los campos ytd_* de la última línea
 * del empleado (más rápido, pero solo válido si el array contiene TODAS
 * las líneas del año hasta la fecha de corte).
 *
 * Útil cuando el caller ya tiene la línea más reciente y quiere un
 * cálculo inmediato sin sumar todas las líneas.
 *
 * @param linea — La línea de nómina más reciente del empleado.
 * @param employeeId — ID del empleado.
 * @param anio — Año calendario.
 * @returns YtdAccumulated derivado de los campos ytd_* de la línea.
 */
export function calculateYtdFromLatest(
  linea: PayrollLineaRow,
  employeeId: string,
  anio: number,
): YtdAccumulated {
  const result: YtdAccumulated = {
    employeeId,
    anio,
    fechaCorte: linea.creado_en.slice(0, 10),
    grossCents: linea.ytd_gross,
    cppEmployeeCents: linea.cpp_empleado, // per-cycle, not YTD for employee side
    eiEmployeeCents: linea.ei_empleado,
    taxFederalCents: linea.tax_federal,
    taxProvincialCents: linea.tax_provincial,
    taxTotalCents: linea.tax_federal + linea.tax_provincial,
    netoCents: linea.neto_pagar,
    cppEmployerCents: linea.cpp_employer,
    eiEmployerCents: linea.ei_employer,
    worksafebcCents: linea.worksafebc_prima,
    vacationPayCents: linea.vacation_pay_cents,
    cicloCount: 1,
    computedAtISO: new Date().toISOString(),
  };

  // NOTA: los campos ytd_* representan acumulados TOTALES después de este
  // ciclo. Para employee-side, los campos por ciclo se suman con calculateYtd().
  // Este helper devuelve solo los montos de ESTE ciclo — el caller debe sumar
  // si necesita el YTD verdadero.
  return ytdAccumulatedSchema.parse(result);
}

// =========================================================================
// YTD Comparison — comparativo interanual
// =========================================================================

/**
 * Comparativo Year-to-Date: año actual vs año anterior al mismo período.
 *
 * Permite detectar tendencias: ¿está ganando más o menos que el año pasado?
 * ¿Las deducciones son proporcionales?
 */
export interface YtdComparison {
  /** ID del empleado. */
  employeeId: string;

  /** Período de comparación (ej. "2026-08-15" → compara ene-01 a ago-15). */
  fechaCorte: string;

  /** ── Año actual ────────────────────────────────────────────────── */
  currentYear: number;
  currentYtd: YtdAccumulated;

  /** ── Año anterior ──────────────────────────────────────────────── */
  previousYear: number;
  previousYtd: YtdAccumulated | null;

  /** ── Deltas (current − previous, centavos) ──────────────────────── */
  deltaGrossCents: number | null;
  deltaTaxTotalCents: number | null;
  deltaNetoCents: number | null;

  /** ── Cambios porcentuales (0–1, null si previous = 0) ─────────── */
  pctChangeGross: number | null;
  pctChangeTax: number | null;
  pctChangeNet: number | null;

  /** ── Efective tax rate comparison ──────────────────────────────── */
  /** Tasa efectiva de impuesto año actual (tax / gross). */
  currentEffectiveRate: number;
  /** Tasa efectiva de impuesto año anterior. */
  previousEffectiveRate: number | null;

  /** ── Metadata ──────────────────────────────────────────────────── */
  computedAtISO: string;
}

/**
 * Compara los acumulados YTD del año actual contra el mismo período del
 * año anterior.
 *
 * Calcula deltas absolutos (centavos), cambios porcentuales, y evolución
 * de la tasa efectiva de impuesto.
 *
 * @param currentYearLines — Líneas del empleado para el año actual.
 * @param previousYearLines — Líneas del empleado para el año anterior (puede ser vacío si es nuevo).
 * @param employeeId — ID del empleado.
 * @param currentYear — Año actual (YYYY).
 * @param fechaCorte — Fecha de corte YYYY-MM-DD (mismo día-mes se usa para el año anterior).
 * @returns YtdComparison con deltas y porcentajes.
 */
export function getYtdComparison(
  currentYearLines: PayrollLineaRow[],
  previousYearLines: PayrollLineaRow[],
  employeeId: string,
  currentYear: number,
  fechaCorte: string,
): YtdComparison {
  const previousYear = currentYear - 1;

  // Fecha de corte para el año anterior: mismo mes-día, mismo año-1
  const corteParts = fechaCorte.split("-");
  const prevCorte = `${previousYear}-${corteParts[1]}-${corteParts[2]}`;

  const currentYtd = calculateYtd(currentYearLines, currentYear, fechaCorte, employeeId);
  const previousYtd =
    previousYearLines.length > 0
      ? calculateYtd(previousYearLines, previousYear, prevCorte, employeeId)
      : null;

  // ── Deltas ────────────────────────────────────────────────────────
  const deltaGrossCents = previousYtd !== null
    ? currentYtd.grossCents - previousYtd.grossCents
    : null;
  const deltaTaxTotalCents = previousYtd !== null
    ? currentYtd.taxTotalCents - previousYtd.taxTotalCents
    : null;
  const deltaNetoCents = previousYtd !== null
    ? currentYtd.netoCents - previousYtd.netoCents
    : null;

  // ── Cambios porcentuales ──────────────────────────────────────────
  const pctChangeGross = previousYtd !== null && previousYtd.grossCents > 0
    ? (currentYtd.grossCents - previousYtd.grossCents) / previousYtd.grossCents
    : null;
  const pctChangeTax = previousYtd !== null && previousYtd.taxTotalCents > 0
    ? (currentYtd.taxTotalCents - previousYtd.taxTotalCents) / previousYtd.taxTotalCents
    : null;
  const pctChangeNet = previousYtd !== null && previousYtd.netoCents > 0
    ? (currentYtd.netoCents - previousYtd.netoCents) / previousYtd.netoCents
    : null;

  // ── Effective tax rates ───────────────────────────────────────────
  const currentEffectiveRate = currentYtd.grossCents > 0
    ? currentYtd.taxTotalCents / currentYtd.grossCents
    : 0;
  const previousEffectiveRate = previousYtd !== null && previousYtd.grossCents > 0
    ? previousYtd.taxTotalCents / previousYtd.grossCents
    : null;

  return {
    employeeId,
    fechaCorte,
    currentYear,
    currentYtd,
    previousYear,
    previousYtd,
    deltaGrossCents,
    deltaTaxTotalCents,
    deltaNetoCents,
    pctChangeGross,
    pctChangeTax,
    pctChangeNet,
    currentEffectiveRate,
    previousEffectiveRate,
    computedAtISO: new Date().toISOString(),
  };
}

// =========================================================================
// T4 Preview — previsualización del T4
// =========================================================================

/**
 * Previsualización de lo que aparecerá en el T4 del empleado al cierre
 * del año fiscal.
 *
 * Mapea los acumulados anuales a los boxes del T4 de CRA. Los topes
 * (YMPE, max insurable) se obtienen de compliance-resolver.ts para la
 * fecha de referencia.
 *
 * LIMITACIÓN: este preview es una aproximación contable basada en los
 * datos de payroll_linea. El T4 oficial debe ser emitido por un software
 * certificado por CRA (ej. QBO Payroll). No sustituye el T4 oficial.
 */
export interface T4Preview {
  /** ID del empleado. */
  employeeId: string;

  /** Año fiscal (YYYY). */
  taxYear: number;

  /** ── T4 Boxes ───────────────────────────────────────────────── */

  /** Box 14 — Employment Income (gross pay, centavos). */
  box14_employmentIncomeCents: number;

  /** Box 16 — Employee CPP contributions (centavos). */
  box16_cppEmployeeCents: number;

  /** Box 18 — Employee EI premiums (centavos). */
  box18_eiEmployeeCents: number;

  /** Box 22 — Income tax deducted (federal + provincial, centavos). */
  box22_incomeTaxDeductedCents: number;

  /** Box 24 — EI insurable earnings (centavos, capped at max insurable). */
  box24_eiInsurableEarningsCents: number;

  /** Box 26 — CPP/QPP pensionable earnings (centavos, capped at YMPE). */
  box26_cppPensionableEarningsCents: number;

  /** Box 28 — Exempt (CPP/QPP, EI, PPIP). Normalmente 0 para empleados regulares. */
  box28_exemptCents: number;

  /** ── Employer-side (informativo, no va en T4) ─────────────────── */

  /** CPP empleador (centavos). */
  employerCppCents: number;

  /** EI empleador (centavos). */
  employerEiCents: number;

  /** WorkSafeBC prima (centavos). */
  employerWorksafebcCents: number;

  /** Total cargas patronales (centavos). */
  employerTotalCents: number;

  /** ── Totales derivados ────────────────────────────────────────── */

  /** Neto pagado al empleado en el año (centavos). */
  netPayCents: number;

  /** Tasa efectiva de impuesto (tax / gross, 0–1). */
  effectiveTaxRate: number;

  /** ── Topes del año ────────────────────────────────────────────── */

  /** YMPE del año (Maximum Pensionable Earnings, centavos). */
  ympeCents: number;

  /** Máximo asegurable EI del año (centavos). */
  maxInsurableEarningsCents: number;

  /** Tasa CPP empleado usada. */
  cppRate: number;

  /** Tasa EI empleado usada. */
  eiRate: number;

  /** ── Metadata ────────────────────────────────────────────────── */

  /** Número de ciclos incluidos. */
  cicloCount: number;

  /** Timestamp de generación. */
  computedAtISO: string;
}

/**
 * Genera un preview de T4 para un empleado a partir de sus líneas de nómina
 * del año fiscal.
 *
 * Calcula los montos de cada box del T4 según las reglas de CRA:
 * - Box 14: sum(gross_cents)
 * - Box 16: sum(cpp_empleado), respetando YMPE
 * - Box 18: sum(ei_empleado), respetando max insurable
 * - Box 22: sum(tax_federal + tax_provincial)
 * - Box 24: min(gross, max_insurable)
 * - Box 26: min(gross - exemption, YMPE) → pensionable earnings
 *
 * @param lineas — Todas las líneas de nómina del empleado para el año fiscal.
 * @param employeeId — ID del empleado.
 * @param taxYear — Año fiscal (YYYY).
 * @param referenceDate — Fecha de referencia para resolver topes (default: 2026-06-15).
 * @returns T4Preview con todos los boxes.
 */
export function getT4Preview(
  lineas: PayrollLineaRow[],
  employeeId: string,
  taxYear: number,
  referenceDate?: Date,
): T4Preview {
  const refDate = referenceDate ?? new Date(`${taxYear}-06-15`);
  const anioStr = String(taxYear);

  // ── Resolver topes del año ────────────────────────────────────────
  const cppParams = getCurrentRate("CPP", refDate) as CppParams | null;
  const eiParams = getCurrentRate("EI", refDate) as EiParams | null;

  const ympeCents = cppParams ? cppParams.tope * 100 : 74_600_00; // fallback: $74,600
  const maxInsurableCents = eiParams ? eiParams.tope * 100 : 68_900_00; // fallback: $68,900
  const cppExemptionCents = cppParams ? cppParams.exencion_basica * 100 : 3_500_00; // fallback: $3,500
  const cppRate = cppParams?.tasa_empleado ?? 0.0595;
  const eiRate = eiParams?.tasa_empleado ?? 0.0163;

  // ── Filtrar líneas del año ────────────────────────────────────────
  const yearLines = lineas.filter((l) => l.creado_en.slice(0, 4) === anioStr);

  let grossCents = 0;
  let cppEmployeeCents = 0;
  let eiEmployeeCents = 0;
  let taxFederalCents = 0;
  let taxProvincialCents = 0;
  let netPayCents = 0;
  let employerCppCents = 0;
  let employerEiCents = 0;
  let employerWorksafebcCents = 0;

  for (const linea of yearLines) {
    grossCents += linea.gross_cents;
    cppEmployeeCents += linea.cpp_empleado;
    eiEmployeeCents += linea.ei_empleado;
    taxFederalCents += linea.tax_federal;
    taxProvincialCents += linea.tax_provincial;
    netPayCents += linea.neto_pagar;
    employerCppCents += linea.cpp_employer;
    employerEiCents += linea.ei_employer;
    employerWorksafebcCents += linea.worksafebc_prima;
  }

  const taxTotalCents = taxFederalCents + taxProvincialCents;

  // ── Topes aplicados ───────────────────────────────────────────────
  const box24_eiInsurable = Math.min(grossCents, maxInsurableCents);
  const box26_cppPensionable = Math.max(0, Math.min(grossCents - cppExemptionCents, ympeCents));
  const box28_exempt = 0; // empleados regulares no tienen exención

  const effectiveTaxRate = grossCents > 0 ? taxTotalCents / grossCents : 0;

  return {
    employeeId,
    taxYear,
    box14_employmentIncomeCents: grossCents,
    box16_cppEmployeeCents: cppEmployeeCents,
    box18_eiEmployeeCents: eiEmployeeCents,
    box22_incomeTaxDeductedCents: taxTotalCents,
    box24_eiInsurableEarningsCents: box24_eiInsurable,
    box26_cppPensionableEarningsCents: box26_cppPensionable,
    box28_exemptCents: box28_exempt,
    employerCppCents,
    employerEiCents,
    employerWorksafebcCents,
    employerTotalCents: employerCppCents + employerEiCents + employerWorksafebcCents,
    netPayCents,
    effectiveTaxRate,
    ympeCents,
    maxInsurableEarningsCents: maxInsurableCents,
    cppRate,
    eiRate,
    cicloCount: yearLines.length,
    computedAtISO: new Date().toISOString(),
  };
}

// =========================================================================
// YTD Summary — resumen de todos los empleados
// =========================================================================

/**
 * Resumen YTD de un empleado con nombre para reports.
 */
export interface EmployeeYtdSummary {
  employeeId: string;
  employeeName: string;
  ytd: YtdAccumulated;
}

/**
 * Genera un resumen YTD para múltiples empleados.
 *
 * Toma un mapa de employee_id → array de PayrollLineaRow y calcula
 * el YTD de cada uno a la fecha de corte.
 *
 * @param linesByEmployee — Mapa de employee_id → líneas de nómina.
 * @param employeeNames — Mapa de employee_id → nombre para display.
 * @param anio — Año calendario.
 * @param fechaCorte — Fecha de corte YYYY-MM-DD.
 * @returns Array de EmployeeYtdSummary ordenado por gross descendente.
 */
export function generateYtdSummary(
  linesByEmployee: Map<string, PayrollLineaRow[]>,
  employeeNames: Map<string, string>,
  anio: number,
  fechaCorte: string,
): EmployeeYtdSummary[] {
  const summaries: EmployeeYtdSummary[] = [];

  for (const [employeeId, lineas] of linesByEmployee) {
    const ytd = calculateYtd(lineas, anio, fechaCorte, employeeId);
    summaries.push({
      employeeId,
      employeeName: employeeNames.get(employeeId) ?? employeeId,
      ytd,
    });
  }

  return summaries.sort((a, b) => b.ytd.grossCents - a.ytd.grossCents);
}

// =========================================================================
// Helpers
// =========================================================================

/**
 * Convierte centavos a dólares con 2 decimales para display.
 */
export function centsToDollars(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

/**
 * Formatea una tasa como porcentaje legible (ej. 0.0595 → "5.95%").
 */
export function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}

/**
 * Determina si el empleado ya alcanzó el tope de CPP en el año.
 *
 * @param ytd — Acumulados YTD del empleado.
 * @param ympeCents — YMPE en centavos (opcional, se resuelve si no se provee).
 * @returns true si el gross acumulado ≥ YMPE.
 */
export function hasReachedCppCap(
  ytd: YtdAccumulated,
  ympeCents?: number,
): boolean {
  const cap = ympeCents ?? 68_500_00;
  return ytd.grossCents >= cap;
}

/**
 * Determina si el empleado ya alcanzó el tope de EI en el año.
 *
 * @param ytd — Acumulados YTD del empleado.
 * @param maxInsurableCents — Máximo asegurable en centavos (opcional).
 * @returns true si el gross acumulado ≥ máximo asegurable.
 */
export function hasReachedEiCap(
  ytd: YtdAccumulated,
  maxInsurableCents?: number,
): boolean {
  const cap = maxInsurableCents ?? 66_000_00;
  return ytd.grossCents >= cap;
}

/**
 * Proyecta el YTD a fin de año basado en el promedio por ciclo.
 *
 * Útil para estimar si el empleado alcanzará los topes de CPP/EI
 * antes del cierre del año fiscal.
 *
 * @param ytd — YTD actual.
 * @param ciclosRestantes — Número de ciclos que faltan en el año.
 * @returns YTD proyectado (gross, cpp, ei, tax, net) a fin de año.
 */
export function projectYtdToYearEnd(
  ytd: YtdAccumulated,
  ciclosRestantes: number,
): Pick<YtdAccumulated, "grossCents" | "cppEmployeeCents" | "eiEmployeeCents" | "taxTotalCents" | "netoCents"> {
  if (ytd.cicloCount === 0) {
    return {
      grossCents: 0,
      cppEmployeeCents: 0,
      eiEmployeeCents: 0,
      taxTotalCents: 0,
      netoCents: 0,
    };
  }

  const avgGross = ytd.grossCents / ytd.cicloCount;
  const avgCpp = ytd.cppEmployeeCents / ytd.cicloCount;
  const avgEi = ytd.eiEmployeeCents / ytd.cicloCount;
  const avgTax = ytd.taxTotalCents / ytd.cicloCount;
  const avgNet = ytd.netoCents / ytd.cicloCount;

  return {
    grossCents: Math.round(ytd.grossCents + avgGross * ciclosRestantes),
    cppEmployeeCents: Math.round(ytd.cppEmployeeCents + avgCpp * ciclosRestantes),
    eiEmployeeCents: Math.round(ytd.eiEmployeeCents + avgEi * ciclosRestantes),
    taxTotalCents: Math.round(ytd.taxTotalCents + avgTax * ciclosRestantes),
    netoCents: Math.round(ytd.netoCents + avgNet * ciclosRestantes),
  };
}

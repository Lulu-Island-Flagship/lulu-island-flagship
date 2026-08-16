import { applyPercentRoundHalfUp } from "./money";

/**
 * v8.4 Capa 4 del Financial Core — Payroll Calculator.
 *
 * Calcula la nómina completa de un empleado para un ciclo de pago a partir
 * de sus eventos laborales (day rates, comisiones, horas extra) y sus
 * acumulados YTD. Aplica todas las deducciones y contribuciones canadienses
 * usando compliance-resolver.ts como source-of-truth versionado.
 *
 * Flujo de cálculo:
 *   1. Sumar eventos laborales → gross del ciclo.
 *   2. CPP (Canada Pension Plan): empleado + empleador (matching 1:1).
 *      Tasa 0.0595, tope $68,500, exención $3,500 → compliance-resolver.ts.
 *   3. EI (Employment Insurance): empleado + empleador (1.4×).
 *      Tasa 0.0163, tope $66,000 → compliance-resolver.ts.
 *   4. Tax Federal (simplificado): primer bracket federal 2026 (15%).
 *   5. Tax Provincial BC: tasa_base del compliance-resolver → getCurrentRate("Tax").
 *   6. Vacation Pay Accrual: 4% (<5 años) o 6% (≥5 años) → BC ESA s.58.
 *   7. WorkSafeBC prima: solo empleador, class_rate × gross / 100.
 *   8. Neto a pagar = gross − deducciones empleado.
 *   9. YTD actualizados = YTD anterior + montos del ciclo.
 *
 * LIMITACIÓN DOCUMENTADA:
 *   El cálculo de retención de impuesto federal/provincial completo requiere
 *   TD1 (Personal Tax Credits Return), PDOC de CRA, y las tablas de retención
 *   oficiales (T4127). Este módulo usa una aproximación simplificada con la
 *   tasa del primer bracket — NO sustituye una nómina certificada. Para T4
 *   oficiales, usar QBO Payroll u otro proveedor certificado por CRA.
 *
 * Interconexiones:
 *   payroll-calculator.ts ──(importa)──→ compliance-resolver.ts (tasas)
 *   payroll-calculator.ts ──(importa)──→ payroll-line.ts (tipos)
 *   payroll-calculator.ts ──(importado por)──→ payroll-engine.ts
 *   payroll-calculator.ts ──(importado por)──→ pay-statement.ts
 */

import { z } from "zod";

import {
  calculateCPP,
  calculateEI,
  calculateEmployerEI,
  calculateVacationAccrual,
  getWorksafeBCPremium,
  getCurrentRate,
  type CppCalculationInput,
  type EiCalculationInput,
  type EmployerEiInput,
} from "./compliance-resolver";

import type { LaborEvent } from "./payroll-line";

// =========================================================================
// Constantes
// =========================================================================

/**
 * Tasa federal 2026 — primer bracket (ingreso gravable hasta ~$57,375).
 * Fuente: CRA indexación anual. Para cálculo oficial usar PDOC/T4127.
 *
 * No existe seed en compliance-engine para el impuesto federal porque
 * depende de TD1, créditos personales y brackets progresivos. Esta
 * constante es una aproximación para provisión contable interna.
 */
const FEDERAL_TAX_RATE_FIRST_BRACKET = 0.15;

/**
 * Períodos de pago por año. Semi-mensual = 24 (invariante B.1 del sistema).
 * NUNCA usar 26 (eso sería quincenal real, no semi-mensual).
 */
const _PAY_PERIODS_PER_YEAR = 24;

// =========================================================================
// Zod Schemas
// =========================================================================

/** Esquema Zod para los acumulados YTD previos. */
export const ytdPreviousSchema = z.object({
  /** Gross acumulado en el año calendario antes de este ciclo (centavos). */
  ytd_gross: z.number().int().nonnegative(),
  /** CPP acumulado (employee side) en el año antes de este ciclo (centavos). */
  ytd_cpp: z.number().int().nonnegative(),
  /** EI acumulado (employee side) en el año antes de este ciclo (centavos). */
  ytd_ei: z.number().int().nonnegative(),
  /** Impuesto (federal + provincial) retenido en el año antes de este ciclo (centavos). */
  ytd_tax: z.number().int().nonnegative(),
});

/** Tipo TypeScript para los YTD previos. */
export type YtdPrevious = z.infer<typeof ytdPreviousSchema>;

/** Esquema Zod para las opciones de calculatePayrollForEmployee. */
export const payrollOptionsSchema = z.object({
  /** Años de servicio continuo — determina tasa de Vacation Pay (4% <5, 6% ≥5). */
  years_of_service: z.number().int().nonnegative().default(0),
  /** Acumulados YTD del empleado ANTES de este ciclo. */
  ytd_previous: ytdPreviousSchema.default({
    ytd_gross: 0,
    ytd_cpp: 0,
    ytd_ei: 0,
    ytd_tax: 0,
  }),
  /** Fecha de inicio del período para resolver tasas vigentes (default: hoy). */
  period_start: z.date().optional(),
});

/** Tipo TypeScript para las opciones. */
export type PayrollOptions = z.input<typeof payrollOptionsSchema>;

// =========================================================================
// Helpers internos
// =========================================================================

/** Acota un valor entre lo y hi. */
function clamp(val: number, lo: number, hi: number): number {
  return Math.min(Math.max(val, lo), hi);
}

/**
 * Cuánto de `cumulative` cae dentro de la banda (bandLow, bandHigh].
 * Usado para calcular el espacio restante hasta topes anuales (YMPE, max insurable).
 */
function _cumulativeInBand(cumulative: number, bandLow: number, bandHigh: number): number {
  return clamp(cumulative, bandLow, bandHigh) - bandLow;
}

// =========================================================================
// Agregación de eventos laborales
// =========================================================================

/** Earnings agregados de los eventos laborales del ciclo. */
interface AggregatedEarnings {
  day_rate_cents: number;
  comisiones_cents: number;
  horas_extra_cents: number;
  gross_cents: number;
}

/**
 * Suma los eventos laborales del ciclo por tipo.
 *
 * Los eventos se agrupan por `tipo` y se suman en centavos enteros.
 * El gross total es la suma de los tres conceptos (day_rate + comisiones + horas_extra).
 */
function aggregateLaborEvents(events: LaborEvent[]): AggregatedEarnings {
  let day_rate_cents = 0;
  let comisiones_cents = 0;
  let horas_extra_cents = 0;

  for (const event of events) {
    switch (event.tipo) {
      case "day_rate":
        day_rate_cents += event.amount_cents;
        break;
      case "comision":
        comisiones_cents += event.amount_cents;
        break;
      case "hora_extra":
        horas_extra_cents += event.amount_cents;
        break;
    }
  }

  const gross_cents = day_rate_cents + comisiones_cents + horas_extra_cents;

  return { day_rate_cents, comisiones_cents, horas_extra_cents, gross_cents };
}

// =========================================================================
// Cálculo de CPP (Canada Pension Plan)
// =========================================================================

interface CppResult {
  employee_cents: number;
  employer_cents: number;
}

/**
 * Calcula la contribución de CPP para el período usando compliance-resolver.
 *
 * El empleador iguala 1:1 la contribución del empleado (matching).
 * La exención básica anual ($3,500) se prorratea por período (24 períodos/año).
 * Las ganancias por encima del YMPE ($68,500) no contribuyen CPP.
 *
 * Delega a calculateCPP() del compliance-resolver que ya maneja:
 *   - Resolución de tasa vigente por fecha
 *   - Prorrateo de exención básica
 *   - Tope por YMPE según YTD acumulado
 */
function calcCpp(gross_cents: number, ytd_pensionable_cents: number, period_start: Date): CppResult {
  const input: CppCalculationInput = {
    grossPayCents: gross_cents,
    periodStart: period_start,
    ytdPensionableCents: ytd_pensionable_cents,
  };

  const result = calculateCPP(input);
  return {
    employee_cents: result.employeeCents,
    employer_cents: result.employeeCents, // matching 1:1
  };
}

// =========================================================================
// Cálculo de EI (Employment Insurance)
// =========================================================================

interface EiResult {
  employee_cents: number;
  employer_cents: number;
}

/**
 * Calcula la prima de EI para el período usando compliance-resolver.
 *
 * Empleado: tasa 0.0163 sobre ganancias asegurables hasta tope $66,000.
 * Empleador: 1.4× la prima del empleado.
 *
 * Delega a calculateEI() y calculateEmployerEI() del compliance-resolver.
 */
function calcEi(gross_cents: number, ytd_insurable_cents: number, period_start: Date): EiResult {
  const eiInput: EiCalculationInput = {
    grossPayCents: gross_cents,
    periodStart: period_start,
    ytdInsurableCents: ytd_insurable_cents,
  };

  const eiResult = calculateEI(eiInput);

  const employerInput: EmployerEiInput = {
    grossPayCents: gross_cents,
    periodStart: period_start,
    ytdInsurableCents: ytd_insurable_cents,
  };

  const employer_cents = calculateEmployerEI(employerInput);

  return {
    employee_cents: eiResult.employeeCents,
    employer_cents,
  };
}

// =========================================================================
// Cálculo de WorkSafeBC (solo empleador)
// =========================================================================

/**
 * Calcula la prima de WorkSafeBC para el período usando compliance-resolver.
 *
 * Solo la paga el empleador. Se calcula como:
 *   class_rate × gross / 100
 *
 * Donde class_rate son dólares por cada $100 de nómina asegurable
 * (ej. class_rate=2.15 → $2.15 por cada $100).
 *
 * Delega a getWorksafeBCPremium() del compliance-resolver.
 */
function calcWorkSafeBc(gross_cents: number, period_start: Date): number {
  return getWorksafeBCPremium({
    totalPayrollCents: gross_cents,
    referenceDate: period_start,
  });
}

// =========================================================================
// Vacation Pay Accrual (BC ESA s.58)
// =========================================================================

/**
 * Calcula el Vacation Pay devengado en el período usando compliance-resolver.
 *
 * BC ESA Parte 7 s.58:
 *   - 4% del gross pay para empleados con <5 años de servicio continuo.
 *   - 6% del gross pay para empleados con ≥5 años de servicio continuo.
 *
 * Delega a calculateVacationAccrual() del compliance-resolver.
 */
function calcVacationPay(gross_cents: number, years_of_service: number, period_start: Date): number {
  return calculateVacationAccrual(gross_cents, years_of_service, period_start);
}

// =========================================================================
// Tax calculation (simplificado — ver LIMITACIÓN arriba)
// =========================================================================

interface TaxResult {
  federal_cents: number;
  provincial_cents: number;
}

/**
 * Calcula la retención de impuestos federal y provincial (aproximación).
 *
 * ESTRATEGIA SIMPLIFICADA (no usar para T4 oficiales):
 *   - Federal: tasa plana del primer bracket (15%) sobre el gross del período.
 *   - Provincial BC: tasa_base del compliance-resolver → getCurrentRate("Tax").
 *
 * El cálculo oficial requiere:
 *   - TD1 federal y TD1BC (créditos personales del empleado).
 *   - Tablas de retención CRA T4127 (federal) y T4127-BC (provincial).
 *   - PDOC (Payroll Deductions Online Calculator) de CRA.
 *
 * Esta aproximación es adecuada para:
 *   - Cálculo interno de costo laboral (margen de contribución).
 *   - Provisión contable del ciclo (accrual).
 *   - Pay statements informativos (con disclaimer).
 *
 * No es adecuada para:
 *   - Remesas a CRA (usar PDOC o QBO Payroll).
 *   - T4 slips oficiales.
 */
function calcTax(gross_cents: number, period_start: Date): TaxResult {
  const federal_cents = Number(applyPercentRoundHalfUp(BigInt(gross_cents), FEDERAL_TAX_RATE_FIRST_BRACKET * 100));

  // Obtener tasa provincial BC desde compliance-resolver
  const bcTaxParams = getCurrentRate("Tax", period_start);
  const provincial_rate = (bcTaxParams as { tasa_base?: number } | null)?.tasa_base ?? 0.0506;
  const provincial_cents = Number(applyPercentRoundHalfUp(BigInt(gross_cents), provincial_rate * 100));

  return { federal_cents, provincial_cents };
}

// =========================================================================
// Resultado del cálculo
// =========================================================================

// ── Sub-interfaces (composable) ──────────────────────────────────────────

/**
 * Desglose de ingresos (earnings) del empleado en el período.
 *
 * Incluye todos los conceptos que suman al gross pay: day rate base,
 * comisiones, horas extra, y vacation pay devengado.
 *
 * Importalo directamente cuando solo necesités los earnings sin
 * deducciones ni YTD: `import type { PayrollEarnings } from "..."`
 */
export interface PayrollEarnings {
  /** Day Rate total del ciclo (base diaria × días trabajados). */
  day_rate_cents: number;
  /** Comisiones ganadas en el ciclo. */
  comisiones_cents: number;
  /** Horas extra pagadas en el ciclo (recargo 1.5× incluido). */
  horas_extra_cents: number;
  /** Vacation Pay devengado en este período. */
  vacation_pay_cents: number;
  /** Total bruto del período = day_rate + comisiones + horas_extra. */
  gross_cents: number;
}

/**
 * Deducciones del empleado en el período.
 *
 * Montos que se retienen del salario bruto: CPP, EI, impuestos
 * federal y provincial.
 */
export interface PayrollDeductions {
  /** CPP empleado. El empleador iguala 1:1. */
  cpp_employee_cents: number;
  /** EI empleado. */
  ei_employee_cents: number;
  /** Retención de impuesto federal estimada. */
  tax_federal_cents: number;
  /** Retención de impuesto provincial BC estimada. */
  tax_provincial_cents: number;
  /** Total deducciones del empleado. */
  total_deductions_cents: number;
}

/**
 * Contribuciones del empleador en el período.
 *
 * Estos montos NO se descuentan del empleado — son costo adicional
 * que el empleador paga (CPP matching, EI 1.4×, WorkSafeBC).
 */
export interface PayrollEmployerContributions {
  /** CPP empleador — matching 1:1 con el empleado. */
  cpp_employer_cents: number;
  /** EI empleador — 1.4× la prima del empleado. */
  ei_employer_cents: number;
  /** WorkSafeBC prima del período (solo empleador). */
  worksafebc_cents: number;
  /** Total contribuciones del empleador. */
  total_employer_cents: number;
}

/**
 * Acumulados Year-To-Date (YTD) después de este ciclo.
 *
 * Refleja los totales acumulados en el año calendario incluyendo
 * las contribuciones de este período.
 */
export interface PayrollYtdSnapshot {
  /** Gross acumulado en el año calendario DESPUÉS de este ciclo. */
  ytd_gross: number;
  /** CPP acumulado (employee side) en el año DESPUÉS de este ciclo. */
  ytd_cpp: number;
  /** EI acumulado (employee side) en el año DESPUÉS de este ciclo. */
  ytd_ei: number;
  /** Impuesto total (federal + provincial) acumulado en el año. */
  ytd_tax: number;
}

// ── Resultado compuesto ─────────────────────────────────────────────────

/**
 * Resultado completo del cálculo de nómina para un empleado en un ciclo.
 *
 * Incluye TODOS los campos necesarios para insertar una fila en payroll_linea
 * y para generar el pay statement correspondiente.
 *
 * Compone {@link PayrollEarnings}, {@link PayrollDeductions},
 * {@link PayrollEmployerContributions}, y {@link PayrollYtdSnapshot}.
 * Si solo necesitás earnings o YTD, importá la sub-interfaz directamente.
 *
 * Todos los montos en centavos enteros CAD.
 */
export interface PayrollCalculationResult
  extends PayrollEarnings,
    PayrollDeductions,
    PayrollEmployerContributions,
    PayrollYtdSnapshot {
  /** UUID del empleado. */
  employee_id: string;

  /** UUID del ciclo de pago. */
  ciclo_id: string;

  /** Tasa de Vacation Pay aplicada (0.04 o 0.06). */
  vacation_pay_rate: number;

  /**
   * Neto a pagar al empleado = gross + vacation_pay − deducciones empleado.
   * Vacation Pay es un earning (se paga al empleado), no una deducción.
   */
  neto_pagar_cents: number;

  /** Años de servicio usados para este cálculo. */
  years_of_service: number;
}

// =========================================================================
// Función principal — calculatePayrollForEmployee()
// =========================================================================

/**
 * Calcula la nómina completa de un empleado para un ciclo de pago.
 *
 * Orquesta todo el pipeline de cálculo usando compliance-resolver.ts como
 * fuente de tasas vigentes:
 *   1. Agrega eventos laborales → gross (day_rate + comisiones + horas_extra).
 *   2. Calcula CPP (empleado + empleador matching 1:1).
 *      Tasa 0.0595, tope $68,500, exención $3,500.
 *   3. Calcula EI (empleado + empleador 1.4×).
 *      Tasa 0.0163, tope $66,000.
 *   4. Calcula Tax (federal 15% + provincial BC via compliance-resolver).
 *   5. Calcula Vacation Pay Accrual (4% <5 años, 6% ≥5 años).
 *   6. Calcula WorkSafeBC prima (class_rate × gross / 100, solo empleador).
 *   7. Calcula neto a pagar = gross + vacation_pay − deducciones.
 *   8. Actualiza YTD acumulados.
 *
 * @param employee_id — UUID del empleado.
 * @param ciclo_id — UUID del ciclo de pago.
 * @param labor_events — Lista de eventos laborales del empleado en este ciclo.
 * @param options — Opciones adicionales (años de servicio, YTD previos, fecha del período).
 * @returns PayrollCalculationResult con todos los breakdowns y YTD actualizados.
 *
 * @example
 * ```ts
 * const result = calculatePayrollForEmployee(
 *   "emp-001",
 *   "ciclo-2026-08-q1",
 *   [
 *     { tipo: "day_rate", amount_cents: 19500, fecha: "2026-08-01" },
 *     { tipo: "day_rate", amount_cents: 19500, fecha: "2026-08-03" },
 *     { tipo: "comision", amount_cents: 5000, fecha: "2026-08-02", referencia: "upsell_123" },
 *   ],
 *   {
 *     years_of_service: 2,
 *     ytd_previous: { ytd_gross: 3500000, ytd_cpp: 180000, ytd_ei: 52000, ytd_tax: 420000 },
 *   }
 * );
 * // result.gross_cents === 44000
 * // result.vacation_pay_rate === 0.04
 * ```
 */
export function calculatePayrollForEmployee(
  employee_id: string,
  ciclo_id: string,
  labor_events: LaborEvent[],
  options: PayrollOptions = {},
): PayrollCalculationResult {
  // Validar y aplicar defaults
  const opts = payrollOptionsSchema.parse(options);
  const { years_of_service, ytd_previous } = opts;
  const period_start = opts.period_start ?? new Date();

  // 1. Agregar eventos laborales → gross
  const earnings = aggregateLaborEvents(labor_events);
  const { gross_cents, day_rate_cents, comisiones_cents, horas_extra_cents } = earnings;

  // 2. CPP (empleado + empleador)
  const cpp = calcCpp(gross_cents, ytd_previous.ytd_gross, period_start);

  // 3. EI (empleado + empleador)
  const ei = calcEi(gross_cents, ytd_previous.ytd_gross, period_start);

  // 4. Tax (federal + provincial BC)
  const tax = calcTax(gross_cents, period_start);

  // 5. Vacation Pay Accrual
  const vacation_pay_cents = calcVacationPay(gross_cents, years_of_service, period_start);
  const vacation_pay_rate = years_of_service >= 5 ? 0.06 : 0.04;

  // 6. WorkSafeBC (solo empleador)
  const worksafebc_cents = calcWorkSafeBc(gross_cents, period_start);

  // 7. Deducciones totales del empleado
  const total_deductions_cents =
    cpp.employee_cents + ei.employee_cents + tax.federal_cents + tax.provincial_cents;

  // 8. Contribuciones totales del empleador
  const total_employer_cents = cpp.employer_cents + ei.employer_cents + worksafebc_cents;

  // 9. Neto a pagar = gross + vacation_pay − deducciones empleado
  //    Vacation Pay es un earning que se paga al empleado
  const total_gross_with_vacation = gross_cents + vacation_pay_cents;
  const neto_pagar_cents = total_gross_with_vacation - total_deductions_cents;

  // 10. YTD actualizados
  const ytd_gross = ytd_previous.ytd_gross + gross_cents;
  const ytd_cpp = ytd_previous.ytd_cpp + cpp.employee_cents;
  const ytd_ei = ytd_previous.ytd_ei + ei.employee_cents;
  const ytd_tax = ytd_previous.ytd_tax + tax.federal_cents + tax.provincial_cents;

  return {
    employee_id,
    ciclo_id,

    // Earnings
    day_rate_cents,
    comisiones_cents,
    horas_extra_cents,
    vacation_pay_cents,
    gross_cents,

    // Deductions (employee)
    cpp_employee_cents: cpp.employee_cents,
    ei_employee_cents: ei.employee_cents,
    tax_federal_cents: tax.federal_cents,
    tax_provincial_cents: tax.provincial_cents,
    total_deductions_cents,

    // Employer contributions
    cpp_employer_cents: cpp.employer_cents,
    ei_employer_cents: ei.employer_cents,
    worksafebc_cents,
    total_employer_cents,

    // Vacation Pay
    vacation_pay_rate,

    // Net
    neto_pagar_cents,

    // YTD
    ytd_gross,
    ytd_cpp,
    ytd_ei,
    ytd_tax,

    // Metadata
    years_of_service,
  };
}

// =========================================================================
// Re-exports para conveniencia del caller
// =========================================================================

export type { LaborEvent } from "./payroll-line";

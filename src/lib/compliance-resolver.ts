/**
 * v8.3 Capa 2 del Financial Core — Compliance Resolver.
 *
 * Resuelve tasas vigentes desde el compliance-engine y expone funciones de
 * cálculo puras para CPP, EI, Vacation Pay, Statutory Holiday Pay y
 * WorkSafeBC. Todas las funciones operan en centavos (cents CAD) para
 * evitar errores de punto flotante — misma convención que payroll.ts y
 * payroll-deductions.ts.
 *
 * Las tasas se leen de los seed data de compliance-engine.ts. En
 * producción, estas tasas deben venir de la base de datos (tabla
 * reglas_legales) consultando la versión VIGENTE para la fecha del
 * período; los seed son el fallback offline y el valor inicial de la
 * migración.
 *
 * IMPACTO EN payroll-deductions.ts: las constantes duras de ese archivo
 * (CPP_RATE_2026, EI_EMPLOYEE_RATE_2026, etc.) deben eventualmente
 * reemplazarse por llamadas a getCurrentRate() de este módulo. Mientras
 * tanto, este resolver es la fuente autoritativa para nuevas rutas de
 * código.
 */

import {
  CPP_2026_SEED,
  EI_2026_SEED,
  VACATION_PAY_BC_2026_SEED,
  WORKSAFEBC_2026_SEED,
  STATUTORY_HOLIDAYS_BC_2026_SEED,
  MIN_WAGE_BC_2026_SEED,
  GST_2026_SEED,
  PST_BC_2026_SEED,
  BC_TAX_2026_SEED,
  type CppParams,
  type EiParams,
  type VacationPayParams,
  type WorkSafeBcParams,
  type MinWageParams,
  type GstParams,
  type PstParams,
  type BcTaxParams,
  type TipoRegla,
  type ReglaLegalRow,
} from "./compliance-engine";

// ---------------------------------------------------------------------------
// Resolvedores de tasa — usan los seed como fallback; en prod deben leer de DB
// ---------------------------------------------------------------------------

/** Pay periods por año — semi-mensual (invariante B.1 del sistema). */
const PAY_PERIODS_PER_YEAR = 24;

/**
 * Resuelve la regla VIGENTE para un tipo dado en una fecha.
 * Hoy usa los seed data estáticos; la versión productiva consultará la
 * tabla `reglas_legales` filtrando por `estado = 'VIGENTE'` y la fecha.
 */
function resolveActiveSeed(tipo: TipoRegla, _at: Date): ReglaLegalRow | null {
  // Fallback estático — en producción esto será un query a la DB.
  // Mapeamos cada tipo a su seed 2026 y verificamos vigencia con isRuleActiveAt.
  const seedMap: Record<TipoRegla, Omit<ReglaLegalRow, "id" | "creado_en" | "creado_por" | "vigente_hasta"> | null> = {
    CPP: CPP_2026_SEED,
    EI: EI_2026_SEED,
    Tax: BC_TAX_2026_SEED,
    GST: GST_2026_SEED,
    PST: PST_BC_2026_SEED,
    WorkSafeBC: WORKSAFEBC_2026_SEED,
    MinWage: MIN_WAGE_BC_2026_SEED,
    VacationPay: VACATION_PAY_BC_2026_SEED,
    StatutoryHolidays: STATUTORY_HOLIDAYS_BC_2026_SEED,
  };

  const seed = seedMap[tipo];
  if (!seed) return null;

  // Simulamos una fila completa con vigente_hasta = null
  const row: ReglaLegalRow = {
    ...seed,
    id: `seed-${tipo}-${seed.version}`,
    creado_en: seed.vigente_desde!,
    creado_por: "seed",
    vigente_hasta: null,
  };

  return isRuleActiveAt(row, _at) ? row : null;
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Retorna los parámetros vigentes para un tipo de regla en una fecha dada.
 * Si no hay regla vigente, retorna null.
 *
 * @param tipo - Tipo de regla legal (CPP, EI, Tax, etc.)
 * @param fecha - Fecha de referencia (default: hoy)
 */
export function getCurrentRate(tipo: "CPP", fecha?: Date): CppParams | null;
export function getCurrentRate(tipo: "EI", fecha?: Date): EiParams | null;
export function getCurrentRate(tipo: "Tax", fecha?: Date): BcTaxParams | null;
export function getCurrentRate(tipo: "GST", fecha?: Date): GstParams | null;
export function getCurrentRate(tipo: "PST", fecha?: Date): PstParams | null;
export function getCurrentRate(tipo: "WorkSafeBC", fecha?: Date): WorkSafeBcParams | null;
export function getCurrentRate(tipo: "MinWage", fecha?: Date): MinWageParams | null;
export function getCurrentRate(tipo: "VacationPay", fecha?: Date): VacationPayParams | null;
export function getCurrentRate(
  tipo: "StatutoryHolidays",
  fecha?: Date
): { total_days: number; jurisdiction: string; pay_rule: string } | null;
/** Catch-all overload para cuando el tipo se resuelve en runtime (ej. desde un feed). */
export function getCurrentRate(tipo: TipoRegla, fecha?: Date): Record<string, unknown> | null;
export function getCurrentRate(tipo: TipoRegla, fecha?: Date): Record<string, unknown> | null {
  const at = fecha ?? new Date();
  const row = resolveActiveSeed(tipo, at);
  if (!row) return null;
  return row.parametros as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// CPP — Canada Pension Plan (deducción del empleado)
// ---------------------------------------------------------------------------

export interface CppCalculationInput {
  /** Pago bruto del período en centavos. */
  grossPayCents: number;
  /** Fecha de inicio del período (para resolver la tasa vigente). */
  periodStart: Date;
  /** Acumulado de ganancias pensionables en el año, ANTES de este período, en centavos. */
  ytdPensionableCents?: number;
}

export interface CppCalculationResult {
  /** Deducción CPP del empleado en centavos. */
  employeeCents: number;
  /** Nuevo YTD después de este período. */
  ytdPensionableAfterCents: number;
  /** Tasa usada para el cálculo. */
  rate: number;
  /** Tope anual usado (YMPE en centavos). */
  ympEcents: number;
}

/**
 * Calcula la deducción CPP del empleado para un período.
 *
 * Fórmula: max(0, min(grossPay - exención_prorrateada, espacio_hasta_ympe) × tasa_empleado)
 * donde exención_prorrateada = exención_basica / 24 (semi-mensual)
 * y espacio_hasta_ympe es lo que falta para llegar al tope anual según el YTD.
 *
 * El empleador iguala 1:1 esta contribución (ver employerCppCents en el resultado).
 */
export function calculateCPP(input: CppCalculationInput): CppCalculationResult {
  const params = getCurrentRate("CPP", input.periodStart);
  if (!params) {
    return { employeeCents: 0, ytdPensionableAfterCents: input.ytdPensionableCents ?? 0, rate: 0, ympEcents: 0 };
  }

  const { tasa_empleado: rate, tope, exencion_basica: exemption } = params;
  const ympEcents = tope * 100;
  const exemptionPerPeriodCents = Math.round((exemption * 100) / PAY_PERIODS_PER_YEAR);
  const ytdBefore = Math.max(0, input.ytdPensionableCents ?? 0);
  const ytdAfter = ytdBefore + input.grossPayCents;

  // Espacio restante hasta el YMPE
  const roomToYmpe = Math.max(0, Math.min(ytdAfter, ympEcents) - Math.min(ytdBefore, ympEcents));
  const grossLessExemption = Math.max(0, input.grossPayCents - exemptionPerPeriodCents);
  const pensionableThisPeriod = Math.min(grossLessExemption, roomToYmpe);

  const employeeCents = Math.round(pensionableThisPeriod * rate);

  return { employeeCents, ytdPensionableAfterCents: ytdAfter, rate, ympEcents };
}

// ---------------------------------------------------------------------------
// EI — Employment Insurance (deducción del empleado)
// ---------------------------------------------------------------------------

export interface EiCalculationInput {
  /** Pago bruto del período en centavos. */
  grossPayCents: number;
  /** Fecha de inicio del período (para resolver la tasa vigente). */
  periodStart: Date;
  /** Acumulado de ganancias asegurables en el año, ANTES de este período, en centavos. */
  ytdInsurableCents?: number;
}

export interface EiCalculationResult {
  /** Deducción EI del empleado en centavos. */
  employeeCents: number;
  /** Nuevo YTD después de este período. */
  ytdInsurableAfterCents: number;
  /** Tasa usada para el cálculo. */
  rate: number;
  /** Tope anual usado (max insurable en centavos). */
  maxInsurableCents: number;
}

/**
 * Calcula la deducción EI del empleado para un período.
 *
 * Fórmula: min(grossPay, espacio_hasta_tope) × tasa_empleado
 * donde espacio_hasta_tope es lo que falta para llegar al máximo asegurable
 * anual según el YTD.
 */
export function calculateEI(input: EiCalculationInput): EiCalculationResult {
  const params = getCurrentRate("EI", input.periodStart);
  if (!params) {
    return {
      employeeCents: 0,
      ytdInsurableAfterCents: input.ytdInsurableCents ?? 0,
      rate: 0,
      maxInsurableCents: 0,
    };
  }

  const { tasa_empleado: rate, tope } = params;
  const maxInsurableCents = tope * 100;
  const ytdBefore = Math.max(0, input.ytdInsurableCents ?? 0);
  const ytdAfter = ytdBefore + input.grossPayCents;

  const insurableThisPeriod = Math.max(
    0,
    Math.min(ytdAfter, maxInsurableCents) - Math.min(ytdBefore, maxInsurableCents)
  );

  const employeeCents = Math.round(insurableThisPeriod * rate);

  return { employeeCents, ytdInsurableAfterCents: ytdAfter, rate, maxInsurableCents };
}

// ---------------------------------------------------------------------------
// EI empleador
// ---------------------------------------------------------------------------

export interface EmployerEiInput {
  /** Pago bruto del período en centavos. */
  grossPayCents: number;
  /** Fecha de inicio del período. */
  periodStart: Date;
  /** YTD asegurable antes del período, en centavos. */
  ytdInsurableCents?: number;
}

/**
 * Calcula la contribución EI del empleador (1.4× la prima del empleado).
 *
 * BC ESA no obliga al empleador a pagar EI directamente — es una obligación
 * federal bajo el Employment Insurance Act. El empleador remite tanto su
 * parte como la del empleado a CRA.
 */
export function calculateEmployerEI(input: EmployerEiInput): number {
  const eiResult = calculateEI({
    grossPayCents: input.grossPayCents,
    periodStart: input.periodStart,
    ytdInsurableCents: input.ytdInsurableCents,
  });

  const params = getCurrentRate("EI", input.periodStart);
  const multiplier = (params as EiParams)?.tasa_employer ?? 1.4;

  return Math.round(eiResult.employeeCents * multiplier);
}

// ---------------------------------------------------------------------------
// Vacation Pay (BC ESA Parte 7 s.58)
// ---------------------------------------------------------------------------

/**
 * Calcula la acumulación de Vacation Pay para un pago bruto.
 *
 * BC ESA: 4% del gross pay con <5 años de antigüedad continua,
 *         6% del gross pay con ≥5 años.
 *
 * @param grossPayCents - Pago bruto en centavos.
 * @param yearsOfService - Años de antigüedad continua del empleado.
 * @param periodStart - Fecha del período (para resolver la tasa vigente; default hoy).
 */
export function calculateVacationAccrual(
  grossPayCents: number,
  yearsOfService: number,
  periodStart?: Date
): number {
  const params = getCurrentRate("VacationPay", periodStart);
  const rateUnder5 = (params as VacationPayParams)?.rate_under_5y ?? 0.04;
  const rate5Plus = (params as VacationPayParams)?.rate_5y_plus ?? 0.06;

  const rate = yearsOfService >= 5 ? rate5Plus : rateUnder5;
  return Math.round(grossPayCents * rate);
}

// ---------------------------------------------------------------------------
// Statutory Holiday Pay (BC ESA Parte 5 s.42-45)
// ---------------------------------------------------------------------------

export interface StatHolidayPayInput {
  /** Tarifa diaria del empleado en centavos (usada como proxy del "average day's pay"). */
  dayRateCents: number;
  /** ¿Es un día festivo estatutario? */
  isHoliday: boolean;
  /** ¿El empleado trabajó ese día? */
  workedOnHoliday?: boolean;
  /** Horas trabajadas el festivo (solo aplica si workedOnHoliday = true). */
  hoursWorkedOnHoliday?: number;
  /** Tarifa horaria del empleado en centavos (para calcular 1.5×). */
  hourlyRateCents?: number;
}

export interface StatHolidayPayResult {
  /** Pago por el festivo (average day's pay) en centavos. */
  holidayPayCents: number;
  /** Pago extra por trabajar el festivo (1.5× horas) en centavos. */
  premiumPayCents: number;
  /** Total a pagar por el festivo en centavos. */
  totalCents: number;
}

/**
 * Calcula el pago por día festivo estatutario según BC ESA.
 *
 * Reglas:
 * - Si NO es festivo: no hay pago extra (retorna 0).
 * - Si es festivo y el empleado NO trabaja: recibe su "average day's pay"
 *   (aquí aproximado como dayRateCents).
 * - Si es festivo y el empleado SÍ trabaja: recibe 1.5× las horas trabajadas
 *   ADEMÁS del average day's pay.
 *
 * Elegibilidad: el llamador debe verificar independientemente que el empleado
 * cumple ≥30 días de empleo y ≥15 días trabajados en los 30 días anteriores.
 * Esta función solo calcula el monto.
 */
export function calculateStatutoryHolidayPay(input: StatHolidayPayInput): StatHolidayPayResult {
  if (!input.isHoliday) {
    return { holidayPayCents: 0, premiumPayCents: 0, totalCents: 0 };
  }

  // Average day's pay — en producción debe calcularse como:
  // totalWagesCentsInPrior30 / daysWorkedInPrior30.
  // Aquí usamos dayRateCents como aproximación por simplicidad.
  const holidayPayCents = input.dayRateCents;

  let premiumPayCents = 0;
  if (input.workedOnHoliday && input.hoursWorkedOnHoliday && input.hourlyRateCents) {
    // 1.5× la tarifa horaria por las horas trabajadas el festivo
    premiumPayCents = Math.round(input.hoursWorkedOnHoliday * input.hourlyRateCents * 1.5);
  }

  return {
    holidayPayCents,
    premiumPayCents,
    totalCents: holidayPayCents + premiumPayCents,
  };
}

// ---------------------------------------------------------------------------
// WorkSafeBC — prima anual del empleador
// ---------------------------------------------------------------------------

export interface WorkSafeBCPremiumInput {
  /** Nómina total asegurable en centavos (para el período o año). */
  totalPayrollCents: number;
  /** Fecha de referencia para resolver la tasa (default: hoy). */
  referenceDate?: Date;
}

/**
 * Calcula la prima de WorkSafeBC para una nómina dada.
 *
 * WorkSafeBC se paga SOLO por el empleador. La tasa se expresa en dólares
 * por cada $100 de nómina asegurable (class_rate). Ejemplo: class_rate=2.15
 * significa $2.15 por cada $100 de nómina.
 *
 * En producción, esta prima se calcula sobre la nómina anual y se ajusta
 * en la reconciliación anual de WorkSafeBC.
 *
 * @returns Prima en centavos.
 */
export function getWorksafeBCPremium(input: WorkSafeBCPremiumInput): number {
  const params = getCurrentRate("WorkSafeBC", input.referenceDate);
  const classRate = (params as WorkSafeBcParams)?.class_rate ?? 2.15;

  // class_rate es $ por cada $100 de nómina → rate = class_rate / 100
  // totalPayrollCents * (class_rate / 100) = totalPayrollCents * class_rate / 100
  return Math.round((input.totalPayrollCents * classRate) / 100);
}

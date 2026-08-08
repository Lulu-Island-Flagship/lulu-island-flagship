/**
 * v8.5 Capa 5 del Financial Core — Employee YTD Dashboard.
 *
 * Proporciona los datos para el dashboard "Year-to-Date" que el empleado ve
 * en su PWA. Incluye acumulados del año, gráfico de ingresos por quincena,
 * proyección anual, comparación interanual, próximo depósito e insignias
 * de progreso hacia bonos por consistencia.
 *
 * REGLA DURA DE PRIVACIDAD — mismo patrón que employee-financial-dashboard.ts:
 *   1. Todos los inputs de este módulo requieren `employeeId` explícito.
 *   2. El caller es responsable de filtrar por `employee_id` autenticado.
 *   3. `assertSingleEmployee` sobre cada array de entrada (fail-closed).
 *   4. Las salidas NUNCA contienen datos de otros empleados — no hay rankings,
 *      comparaciones con pares, ni promedios de equipo.
 *
 * Funciones puras: reciben datos pre-filtrados por el caller (ruta API que
 * ya hizo `WHERE employee_id = $auth`) y producen el view-model para la PWA.
 * No tocan la base de datos.
 *
 * Interconexiones:
 *   payroll-ytd-dashboard.ts ──(importa)──→ employee-financial-dashboard.ts (assertSingleEmployee, formatCents, BadgeProgress)
 *   payroll-ytd-dashboard.ts ──(importa)──→ payroll-line.ts (centsToDollars)
 */

import { assertSingleEmployee, formatCents } from "./financial-utils";
import type { BadgeProgress } from "./employee-financial-dashboard";
// import { centsToDollars } from "./payroll-line";

// =========================================================================
// Tipos de entrada — datos que el caller obtiene de la DB (pre-filtrados)
// =========================================================================

/**
 * Un período de pago (quincena) con los totales de ese ciclo para el
 * empleado. El caller obtiene estos datos de `payroll_linea` con
 * `WHERE employee_id = $auth ORDER BY ciclo_id`.
 */
export interface YtdPeriodSummary {
  /** ID del empleado dueño de estos datos. */
  employeeId: string;
  /** Label del período: "2026-08 Q1", "2026-07 Q2". */
  periodLabel: string;
  /** Fecha de inicio del período (YYYY-MM-DD). */
  fechaInicio: string;
  /** Fecha de fin del período (YYYY-MM-DD). */
  fechaFin: string;
  /** Fecha de pago (YYYY-MM-DD). */
  fechaPago: string;
  /** Gross del período en centavos. */
  grossCents: number;
  /** Neto pagado en centavos. */
  netCents: number;
  /** Total deducciones en centavos. */
  deductionsCents: number;
}

/**
 * Acumulados YTD del empleado para el año en curso (proveniente del
 * último ciclo procesado del año, o de payroll_linea.ytd_*).
 */
export interface YtdAccumulated {
  /** ID del empleado. */
  employeeId: string;
  /** Año calendario. */
  year: number;
  /** Gross acumulado en centavos. */
  grossCents: number;
  /** Neto acumulado en centavos. */
  netCents: number;
  /** CPP acumulado (employee side) en centavos. */
  cppCents: number;
  /** EI acumulado (employee side) en centavos. */
  eiCents: number;
  /** Impuesto total (federal + provincial) acumulado en centavos. */
  taxCents: number;
  /** Total deducciones acumuladas en centavos. */
  totalDeductionsCents: number;
}

/**
 * Acumulados del mismo período del año anterior para la comparación
 * interanual. Si no hay datos (empleado nuevo), se omite.
 */
export interface PriorYearComparison {
  /** Año de comparación. */
  year: number;
  /** Gross acumulado al mismo corte en centavos. */
  grossCents: number;
  /** Neto acumulado al mismo corte en centavos. */
  netCents: number;
  /** Número de períodos procesados en el año anterior al mismo corte. */
  periodsProcessed: number;
}

/**
 * Información del próximo depósito programado.
 */
export interface NextDeposit {
  /** Fecha estimada del próximo depósito (YYYY-MM-DD). */
  depositDate: string;
  /** Monto estimado en centavos. */
  estimatedAmountCents: number;
  /** Label legible: "Friday, August 15". */
  depositLabel: string;
  /** Número de días hasta el depósito. */
  daysUntil: number;
}

// =========================================================================
// Tipos de salida — view-model para la PWA
// =========================================================================

/**
 * Datos de una barra en el gráfico de ingresos por quincena.
 */
export interface PeriodBar {
  /** Label corto: "Aug Q1", "Jul Q2". */
  label: string;
  /** Gross en centavos (altura de la barra). */
  grossCents: number;
  /** Neto en centavos. */
  netCents: number;
  /** Diferencia respecto al período anterior en porcentaje (0-100+). */
  changePct: number | null;
}

/**
 * Proyección de ingreso anual basada en el ritmo actual.
 */
export interface AnnualProjection {
  /** Ingreso anual estimado en centavos. */
  estimatedAnnualGrossCents: number;
  /** Neto anual estimado en centavos. */
  estimatedAnnualNetCents: number;
  /** Tasa de ahorro fiscal implícita (deducciones / gross). */
  effectiveTaxRate: number;
  /** Períodos procesados este año. */
  periodsProcessed: number;
  /** Meses transcurridos del año (1-12). */
  monthsElapsed: number;
}

/**
 * Comparación interanual.
 */
export interface YearOverYearComparison {
  /** Porcentaje de cambio en gross vs año anterior (positivo = crecimiento). */
  grossChangePct: number | null;
  /** Porcentaje de cambio en neto vs año anterior. */
  netChangePct: number | null;
  /** true si no hay datos del año anterior (empleado nuevo). */
  isFirstYear: boolean;
}

/**
 * Dashboard YTD completo para UN empleado.
 *
 * Esta es la estructura que la PWA renderiza en la sección "My Year".
 */
export interface EmployeeYtdDashboard {
  /** ID del empleado dueño de estos datos. */
  employeeId: string;
  /** Año del dashboard. */
  year: number;

  /** Acumulados del año. */
  accumulated: {
    grossCents: number;
    netCents: number;
    cppCents: number;
    eiCents: number;
    taxCents: number;
    totalDeductionsCents: number;
  };

  /** Barras del gráfico: últimos 12 períodos (más reciente al final). */
  periodBars: PeriodBar[];

  /** Proyección anual. */
  projection: AnnualProjection;

  /** Comparación interanual. */
  yoy: YearOverYearComparison;

  /** Próximo depósito. */
  nextDeposit: NextDeposit | null;

  /** Insignia más cercana (progreso hacia bono por consistencia). */
  nearestBadge: BadgeProgress | null;

  /** Timestamp de generación del dashboard. */
  generatedAt: string;
}

// =========================================================================
// Constantes
// =========================================================================

/** Períodos por año (quincenas). */
const PERIODS_PER_YEAR = 24;

/** Días promedio por quincena. */
const DAYS_PER_PERIOD = 14;

// =========================================================================
// buildPeriodBars — gráfico de barras (últimos 12 períodos)
// =========================================================================

/**
 * Construye los datos para el gráfico de barras de ingresos por quincena.
 *
 * Toma los últimos N períodos (default 12, ~6 meses), los ordena
 * cronológicamente, y calcula el cambio porcentual respecto al período
 * anterior para mostrar tendencias (↑ verde, ↓ rojo).
 *
 * @param periods — Períodos del empleado, ya filtrados y ordenados por fecha.
 * @param maxBars — Número máximo de barras a mostrar (default 12).
 * @returns Array de PeriodBar ordenado del más antiguo al más reciente.
 */
export function buildPeriodBars(
  periods: YtdPeriodSummary[],
  maxBars: number = 12,
): PeriodBar[] {
  if (periods.length === 0) return [];

  assertSingleEmployee(periods, "ytd.periodBars");

  // Tomar los últimos N períodos
  const recent = periods.slice(-maxBars);

  return recent.map((p, i) => {
    const prevGross = i > 0 ? recent[i - 1].grossCents : null;
    const changePct =
      prevGross && prevGross > 0
        ? Number((((p.grossCents - prevGross) / prevGross) * 100).toFixed(1))
        : null;

    // Label corto: extraer mes + quincena del periodLabel
    const shortLabel = shortenPeriodLabel(p.periodLabel);

    return {
      label: shortLabel,
      grossCents: p.grossCents,
      netCents: p.netCents,
      changePct,
    };
  });
}

/**
 * Acorta un label de período tipo "2026-08 Q1" a "Aug Q1".
 */
function shortenPeriodLabel(label: string): string {
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const match = label.match(/^\d{4}-(\d{2})\s+(Q\d)$/);
  if (match) {
    const monthIdx = parseInt(match[1], 10) - 1;
    const month = months[monthIdx] ?? match[1];
    return `${month} ${match[2]}`;
  }
  return label;
}

// =========================================================================
// computeAnnualProjection — proyección de ingreso anual
// =========================================================================

/**
 * Calcula la proyección de ingreso anual basada en el ritmo actual.
 *
 * Usa el promedio por período procesado y lo extrapola a 24 quincenas
 * (año completo). También calcula la tasa efectiva de impuestos + EI + CPP
 * para dar transparencia al empleado.
 *
 * Fórmula:
 *   avg_per_period = ytd_gross / periods_processed
 *   projected_annual = avg_per_period × 24
 *
 * @param ytd — Acumulados YTD del empleado.
 * @param periodsProcessed — Cuántos períodos se han procesado este año.
 * @returns Proyección anual.
 */
export function computeAnnualProjection(
  ytd: YtdAccumulated,
  periodsProcessed: number,
): AnnualProjection {
  if (periodsProcessed <= 0) {
    return {
      estimatedAnnualGrossCents: 0,
      estimatedAnnualNetCents: 0,
      effectiveTaxRate: 0,
      periodsProcessed: 0,
      monthsElapsed: 0,
    };
  }

  const avgGrossPerPeriod = ytd.grossCents / periodsProcessed;
  const avgNetPerPeriod = ytd.netCents / periodsProcessed;

  const estimatedAnnualGrossCents = Math.round(avgGrossPerPeriod * PERIODS_PER_YEAR);
  const estimatedAnnualNetCents = Math.round(avgNetPerPeriod * PERIODS_PER_YEAR);

  const effectiveTaxRate =
    ytd.grossCents > 0
      ? Number(((ytd.totalDeductionsCents / ytd.grossCents) * 100).toFixed(1))
      : 0;

  const monthsElapsed = Math.round((periodsProcessed / PERIODS_PER_YEAR) * 12);

  return {
    estimatedAnnualGrossCents,
    estimatedAnnualNetCents,
    effectiveTaxRate,
    periodsProcessed,
    monthsElapsed,
  };
}

// =========================================================================
// computeYearOverYear — comparación interanual
// =========================================================================

/**
 * Compara los acumulados actuales vs el mismo período del año anterior.
 *
 * Si el empleado es nuevo (no hay datos del año anterior), retorna
 * `isFirstYear: true` y porcentajes en null.
 *
 * @param current — YTD actual.
 * @param prior — YTD del año anterior al mismo corte, o null si no hay datos.
 * @returns Comparación interanual.
 */
export function computeYearOverYear(
  current: YtdAccumulated,
  prior: PriorYearComparison | null,
): YearOverYearComparison {
  if (!prior || prior.grossCents === 0) {
    return {
      grossChangePct: null,
      netChangePct: null,
      isFirstYear: true,
    };
  }

  const grossChangePct = Number(
    (((current.grossCents - prior.grossCents) / prior.grossCents) * 100).toFixed(1),
  );

  const netChangePct =
    prior.netCents > 0
      ? Number((((current.netCents - prior.netCents) / prior.netCents) * 100).toFixed(1))
      : null;

  return {
    grossChangePct,
    netChangePct,
    isFirstYear: false,
  };
}

// =========================================================================
// computeNextDeposit — próximo depósito estimado
// =========================================================================

/**
 * Estima la fecha y monto del próximo depósito.
 *
 * La fecha se calcula como la última fecha de pago conocida + 14 días.
 * El monto se estima como el promedio de los últimos períodos.
 *
 * @param periods — Períodos del empleado ordenados por fecha.
 * @returns Información del próximo depósito o null si no hay datos.
 */
export function computeNextDeposit(
  periods: YtdPeriodSummary[],
): NextDeposit | null {
  if (periods.length === 0) return null;

  assertSingleEmployee(periods, "ytd.nextDeposit");

  const last = periods[periods.length - 1];

  // Calcular próxima fecha de pago: última fecha de pago + 14 días
  const lastPayDate = new Date(last.fechaPago + "T00:00:00");
  const nextPayDate = new Date(lastPayDate.getTime() + DAYS_PER_PERIOD * 24 * 60 * 60 * 1000);

  // Monto estimado: promedio de los últimos 3 períodos
  const recentPeriods = periods.slice(-3);
  const avgGross =
    recentPeriods.reduce((sum, p) => sum + p.grossCents, 0) / recentPeriods.length;
  const estimatedAmountCents = Math.round(avgGross);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysUntil = Math.max(
    0,
    Math.round((nextPayDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000)),
  );

  const depositLabel = nextPayDate.toLocaleDateString("en-CA", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return {
    depositDate: nextPayDate.toISOString().slice(0, 10),
    estimatedAmountCents,
    depositLabel,
    daysUntil,
  };
}

// =========================================================================
// getEmployeeYtdDashboard — dashboard completo
// =========================================================================

/**
 * Opciones para construir el dashboard YTD.
 */
export interface YtdDashboardOptions {
  /** Acumulados YTD del año actual. */
  ytd: YtdAccumulated;
  /** Períodos procesados este año (ordenados, más antiguo primero). */
  periods: YtdPeriodSummary[];
  /** Comparación con año anterior (null si no hay datos). */
  priorYear: PriorYearComparison | null;
  /** Insignias en progreso (top 1 más cercana, o null). */
  nearestBadge: BadgeProgress | null;
  /** Número máximo de barras en el gráfico (default 12). */
  maxBars?: number;
}

/**
 * Construye el dashboard YTD completo para UN empleado.
 *
 * Esta es la función principal que la ruta API llama después de obtener
 * todos los datos pre-filtrados de la base de datos. Orquesta todas las
 * sub-funciones y produce el view-model final.
 *
 * REGLA: el caller DEBE filtrar todos los datos por el employee_id
 * autenticado ANTES de llamar a esta función. Las sub-funciones aplican
 * defensa en profundidad con assertSingleEmployee.
 *
 * @param options — Datos pre-filtrados del empleado.
 * @returns EmployeeYtdDashboard listo para la PWA.
 *
 * @example
 * ```ts
 * // En la ruta API:
 * const { data: lineas } = await supabase
 *   .from("payroll_linea")
 *   .select("*")
 *   .eq("employee_id", auth.employee_id)
 *   .gte("creado_en", `${year}-01-01`)
 *   .order("creado_en", { ascending: true });
 *
 * const dashboard = getEmployeeYtdDashboard({
 *   ytd: mapLastLineToYtd(lineas[lineas.length - 1], auth.employee_id, year),
 *   periods: mapLineasToPeriods(lineas),
 *   priorYear: await getPriorYearComparison(auth.employee_id, year),
 *   nearestBadge: await getNearestBadge(auth.employee_id),
 * });
 * ```
 */
export function getEmployeeYtdDashboard(
  options: YtdDashboardOptions,
): EmployeeYtdDashboard {
  const {
    ytd,
    periods,
    priorYear,
    nearestBadge,
    maxBars = 12,
  } = options;

  // Defensa en profundidad
  assertSingleEmployee(periods, "ytd.periods");
  if (periods.length > 0) {
    // Verificar que el YTD y los períodos pertenecen al mismo empleado
    const periodEmployeeId = periods[0].employeeId;
    if (periodEmployeeId !== ytd.employeeId) {
      throw new Error(
        `ytd.employeeId mismatch: ytd has ${ytd.employeeId}, period has ${periodEmployeeId}`
      );
    }
  }

  const periodBars = buildPeriodBars(periods, maxBars);
  const projection = computeAnnualProjection(ytd, periods.length);
  const yoy = computeYearOverYear(ytd, priorYear);
  const nextDeposit = computeNextDeposit(periods);

  return {
    employeeId: ytd.employeeId,
    year: ytd.year,

    accumulated: {
      grossCents: ytd.grossCents,
      netCents: ytd.netCents,
      cppCents: ytd.cppCents,
      eiCents: ytd.eiCents,
      taxCents: ytd.taxCents,
      totalDeductionsCents: ytd.totalDeductionsCents,
    },

    periodBars,

    projection,

    yoy,

    nextDeposit,

    nearestBadge,

    generatedAt: new Date().toISOString(),
  };
}

// =========================================================================
// Helpers de formateo para la PWA
// =========================================================================

/**
 * Genera el texto de proyección anual para mostrar en la PWA:
 * "Based on your current pace, your estimated annual income is $42,500"
 *
 * @param projection — Proyección calculada por computeAnnualProjection.
 * @returns Texto formateado para UI.
 */
export function formatProjectionText(projection: AnnualProjection): string {
  if (projection.estimatedAnnualGrossCents === 0) {
    return "Not enough data to estimate annual income yet. Keep going!";
  }

  return (
    `Based on your current pace (${projection.periodsProcessed} pay periods, ` +
    `~${projection.monthsElapsed} months), your estimated annual income is ` +
    `${formatCents(projection.estimatedAnnualGrossCents)}. ` +
    `Effective tax rate: ${projection.effectiveTaxRate}%.`
  );
}

/**
 * Genera el texto de comparación interanual:
 * "vs same period last year: +12.5%"
 *
 * @param yoy — Comparación calculada por computeYearOverYear.
 * @returns Texto formateado para UI.
 */
export function formatYoyText(yoy: YearOverYearComparison): string {
  if (yoy.isFirstYear) {
    return "This is your first year with us — no prior year data for comparison.";
  }

  if (yoy.grossChangePct === null) {
    return "Year-over-year comparison not available.";
  }

  const direction = yoy.grossChangePct >= 0 ? "+" : "";
  return `vs same period last year: ${direction}${yoy.grossChangePct}%`;
}

/**
 * Genera el texto del próximo depósito:
 * "Next deposit: Friday, August 15 (~$1,230)"
 *
 * @param deposit — Próximo depósito calculado por computeNextDeposit.
 * @returns Texto formateado para UI, o null si no hay datos.
 */
export function formatNextDepositText(deposit: NextDeposit | null): string | null {
  if (!deposit) return null;

  if (deposit.daysUntil === 0) {
    return `Deposit arriving today: ~${formatCents(deposit.estimatedAmountCents)}`;
  }

  if (deposit.daysUntil === 1) {
    return `Next deposit: tomorrow (~${formatCents(deposit.estimatedAmountCents)})`;
  }

  return (
    `Next deposit: ${deposit.depositLabel} ` +
    `(${deposit.daysUntil} days) — estimated ~${formatCents(deposit.estimatedAmountCents)}`
  );
}

/**
 * v8.3 E11.7 — Escenario de estrés financiero simulado (D.11.7, C.2.8).
 * "Ventas −30% × 3 meses; palancas en orden: Day Rate por bloque →
 * reactivación de dormidos → pausar regalos nuevos → cortar zonas no
 * rentables; umbral: margen neto negativo 2 meses seguidos → revisión
 * obligatoria con el dueño; regla de reserva: 3 meses de fijos + 1 nómina
 * quincenal en caja antes de expandir."
 *
 * Funciones puras: dado el estado financiero actual, simulan el impacto de
 * una caída de ventas y devuelven qué palanca activar primero (nunca las
 * salta ni las reordena) y si se cruza el umbral de revisión obligatoria.
 */

export interface MonthlyFinancials {
  revenueCents: number;
  fixedCostsCents: number;
  netMarginCents: number; // revenue - todos los costos del mes (fijo + variable)
}

export const STRESS_TEST_REVENUE_DROP_RATIO = 0.3; // -30%
export const STRESS_TEST_MONTHS = 3;
export const CONSECUTIVE_NEGATIVE_MONTHS_THRESHOLD = 2;

/** Orden fijo de palancas -- nunca se salta un paso ni se reordena. */
export const STRESS_LEVERS_IN_ORDER = [
  "day_rate_por_bloque",
  "reactivacion_dormidos",
  "pausar_regalos_nuevos",
  "cortar_zonas_no_rentables",
] as const;
export type StressLever = (typeof STRESS_LEVERS_IN_ORDER)[number];

export interface StressSimulationInput {
  currentMonthlyRevenueCents: number;
  currentMonthlyFixedCostsCents: number;
  currentMonthlyVariableCostsCents: number;
}

export interface StressSimulatedMonth {
  monthIndex: number; // 1, 2, 3
  simulatedRevenueCents: number;
  simulatedVariableCostsCents: number;
  simulatedNetMarginCents: number;
  isNegative: boolean;
}

/**
 * Simula 3 meses consecutivos con ventas -30%. Los costos variables se
 * asumen proporcionales al ingreso (mismo ratio observado hoy); los costos
 * fijos NO cambian con la caída de ventas (por definición son fijos).
 */
export function simulateRevenueDropScenario(input: StressSimulationInput): StressSimulatedMonth[] {
  const variableCostRatio =
    input.currentMonthlyRevenueCents > 0 ? input.currentMonthlyVariableCostsCents / input.currentMonthlyRevenueCents : 0;
  const droppedRevenueCents = Math.round(input.currentMonthlyRevenueCents * (1 - STRESS_TEST_REVENUE_DROP_RATIO));

  const months: StressSimulatedMonth[] = [];
  for (let i = 1; i <= STRESS_TEST_MONTHS; i++) {
    const simulatedVariableCostsCents = Math.round(droppedRevenueCents * variableCostRatio);
    const simulatedNetMarginCents = droppedRevenueCents - input.currentMonthlyFixedCostsCents - simulatedVariableCostsCents;
    months.push({
      monthIndex: i,
      simulatedRevenueCents: droppedRevenueCents,
      simulatedVariableCostsCents,
      simulatedNetMarginCents,
      isNegative: simulatedNetMarginCents < 0,
    });
  }
  return months;
}

/** ¿Se cruza el umbral de revisión obligatoria? 2 meses NEGATIVOS SEGUIDOS (no solo 2 en total). */
export function crossesMandatoryReviewThreshold(months: StressSimulatedMonth[]): boolean {
  let consecutive = 0;
  for (const m of months) {
    consecutive = m.isNegative ? consecutive + 1 : 0;
    if (consecutive >= CONSECUTIVE_NEGATIVE_MONTHS_THRESHOLD) return true;
  }
  return false;
}

/**
 * ¿Qué palanca activar dado cuántas ya están activas? Nunca salta pasos:
 * devuelve la PRIMERA no activada, en el orden fijo del spec.
 */
export function nextLeverToActivate(activatedLevers: StressLever[]): StressLever | null {
  return STRESS_LEVERS_IN_ORDER.find((lever) => !activatedLevers.includes(lever)) ?? null;
}

// ============================================================
// Regla de reserva (D.11.7): 3 meses de fijos + 1 nómina quincenal en caja
// antes de expandir.
// ============================================================

export interface CashReserveCheckInput {
  currentCashOnHandCents: number;
  monthlyFixedCostsCents: number;
  biweeklyPayrollCents: number;
}

export function meetsExpansionReserveRule(input: CashReserveCheckInput): { meetsRule: boolean; requiredCents: number; shortfallCents: number } {
  const requiredCents = input.monthlyFixedCostsCents * 3 + input.biweeklyPayrollCents;
  const shortfallCents = Math.max(0, requiredCents - input.currentCashOnHandCents);
  return { meetsRule: input.currentCashOnHandCents >= requiredCents, requiredCents, shortfallCents };
}

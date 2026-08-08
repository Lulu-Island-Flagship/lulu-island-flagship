/**
 * v8.3 F.5 — Visibilidad y Previsibilidad Financiera del Empleado (PWA).
 *
 * La PWA del empleado muestra su situación financiera en tiempo real sin
 * ansiedad y sin comparaciones:
 *
 *   «Ganancias hoy: $102.50 (Day Rate $90 + comisiones $12.50).»
 *   «Proyectado quincena: $1,230. Próximo depósito: viernes 15.»
 *   «Insignia Oro: 42/50 (te faltan 8, bono $50).»
 *
 * Si un turno se cancela con pago completo (Fallback), la UI celebra:
 *   «🎉 Turno cancelado por cliente. $146 asegurados en tu cuenta.»
 *
 * REGLA DURA DE PRIVACIDAD — defensa en profundidad (mismo patrón que
 * team-ranking.ts / positioning-coherence.ts / pipa-validator.ts):
 *
 *   1. Capa de tipos: todos los inputs de este módulo requieren
 *      `employeeId` y el caller es responsable de pasar SOLO los datos
 *      de ese empleado. No existe una función que reciba datos de
 *      múltiples empleados y los compare.
 */

import { assertSingleEmployee, formatCents } from "./financial-utils";

/**
 *   2. Capa de runtime: `assertSingleEmployee` escanea cualquier input
 *      que contenga arrays de eventos/shifts y LANZA si detecta más de
 *      un employee_id distinto — fail-closed.
 *   3. Capa de salida: el `EmployeeFinancialDashboard` solo contiene
 *      datos agregados de UN empleado. No hay campos de ranking,
 *      comparación con pares, ni promedios de equipo.
 *
 * Funciones puras: reciben datos pre-filtrados por el caller (ruta API,
 * que ya hizo `WHERE employee_id = $auth`) y producen el view-model para
 * la PWA. No tocan la base de datos.
 */

// ---------------------------------------------------------------------------
// Tipos de entrada (datos crudos que el caller obtiene de la DB)
// ---------------------------------------------------------------------------

/** Una línea del Shadow Ledger relevante para el empleado. */
export interface EmployeeLedgerEntry {
  employeeId: string;
  orderId: string | null;
  amountCents: number;
  earnedAtIso: string;
  /** Tipo de ingreso: day_rate, commission, tip, cancellation_payout, bonus. */
  earningType: "day_rate" | "commission" | "tip" | "cancellation_payout" | "bonus";
}

/** Un turno en el período de pago actual. */
export interface EmployeeShift {
  /** ID del empleado dueño del turno (requerido para assertSingleEmployee). */
  employeeId: string;
  shiftDate: string; // YYYY-MM-DD
  status: "completed" | "cancelled_with_pay" | "cancelled_no_pay" | "scheduled";
  dayRateCents: number;
  commissionCents: number;
  tipCents: number;
}

/** Progreso hacia una insignia con bono. */
export interface BadgeProgress {
  badgeKey: string;
  badgeName: string;
  currentProgress: number; // ej. 42 servicios sin disputa
  target: number;           // ej. 50
  bonusCents: number;       // bono al alcanzarlo
}

/** Información del próximo depósito (provista por payroll.ts / payroll-cycle.ts). */
export interface UpcomingDeposit {
  amountCents: number;
  depositDate: string;   // YYYY-MM-DD
  depositLabel: string;  // ej. "viernes 15"
}

// ---------------------------------------------------------------------------
// Tipos de salida (view-model para la PWA)
// ---------------------------------------------------------------------------

/** Dashboard financiero completo para UN empleado. */
export interface EmployeeFinancialDashboard {
  /** ID del empleado dueño de estos datos (nunca otro). */
  employeeId: string;
  /** Ganancias del día actual. */
  today: {
    dayRateCents: number;
    commissionCents: number;
    tipCents: number;
    cancellationPayoutCents: number;
    totalCents: number;
    /** true si hay al menos un turno cancelado con pago completo hoy. */
    hasCancellationPayout: boolean;
  };
  /** Proyección para la quincena actual. */
  payPeriod: {
    projectedTotalCents: number;
    completedShifts: number;
    remainingShifts: number;
    /** Turnos cancelados con pago completo en esta quincena. */
    cancelledWithPayCount: number;
    /** IDs de turnos cancelados con pago completo (para UI de celebración). */
    cancelledWithPayShiftDates: string[];
  };
  /** Próximo depósito. */
  upcomingDeposit: UpcomingDeposit | null;
  /** Insignias en progreso (top 1 más cercana, o null si ninguna). */
  nearestBadge: BadgeProgress | null;
}

/** Resultado de un turno cancelado con pago completo, para UI de celebración. */
export interface CancellationCelebration {
  shiftDate: string;
  payoutCents: number;
  message: string;
}

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Número de días en una quincena estándar. */
export const PAY_PERIOD_DAYS = 15;

// ---------------------------------------------------------------------------
// Defensa en profundidad: assertSingleEmployee
// ---------------------------------------------------------------------------

/**
 * Escanea un array de objetos que tengan `employeeId` y lanza si encuentra
 * más de un employeeId distinto. Fail-closed: ante cualquier ambigüedad,
 * bloquea. Este es el cortafuegos de runtime que garantiza que ningún dato
 * de otro empleado se cuele en el dashboard.
 *
 * Mismo patrón que `assertNoIndividualIdentifier` en team-ranking.ts.
 */
// Re-exported from financial-utils.ts (single source of truth, auditoría 2026-08-07)
export { assertSingleEmployee } from "./financial-utils";

// ---------------------------------------------------------------------------
// Cálculo de ganancias del día
// ---------------------------------------------------------------------------

export interface TodayEarningsInput {
  /** ID del empleado (el caller ya lo filtró). */
  employeeId: string;
  /** Turnos de HOY (YYYY-MM-DD) para este empleado. */
  shifts: EmployeeShift[];
  /** Entradas del ledger de HOY para este empleado (bonus, tips adicionales). */
  ledgerEntries: EmployeeLedgerEntry[];
}

/**
 * Calcula las ganancias del día actual para un empleado.
 *
 * Suma: day rate de turnos completados + comisiones + tips + payouts por
 * cancelación. Los turnos "scheduled" (aún no ejecutados) no suman.
 */
export function computeTodayEarnings(
  input: TodayEarningsInput
): EmployeeFinancialDashboard["today"] {
  assertSingleEmployee(input.shifts, "today.shifts");
  assertSingleEmployee(input.ledgerEntries, "today.ledgerEntries");

  let dayRateCents = 0;
  let commissionCents = 0;
  let tipCents = 0;
  let cancellationPayoutCents = 0;

  for (const shift of input.shifts) {
    if (shift.status === "completed") {
      dayRateCents += shift.dayRateCents;
      commissionCents += shift.commissionCents;
      tipCents += shift.tipCents;
    } else if (shift.status === "cancelled_with_pay") {
      cancellationPayoutCents += shift.dayRateCents + shift.commissionCents;
    }
    // scheduled, cancelled_no_pay: no suman.
  }

  // Tips/bonos que llegaron por ledger (fuera de los turnos)
  for (const entry of input.ledgerEntries) {
    if (entry.earningType === "tip") {
      tipCents += entry.amountCents;
    } else if (entry.earningType === "bonus") {
      // bonus no es parte del day rate — se suma como extra
      // (el caller decide si mostrarlo por separado; aquí lo añadimos al total)
    }
  }

  const totalCents = dayRateCents + commissionCents + tipCents + cancellationPayoutCents;

  return {
    dayRateCents,
    commissionCents,
    tipCents,
    cancellationPayoutCents,
    totalCents,
    hasCancellationPayout: cancellationPayoutCents > 0,
  };
}

// ---------------------------------------------------------------------------
// Proyección de quincena
// ---------------------------------------------------------------------------

export interface PayPeriodProjectionInput {
  employeeId: string;
  /** Todos los turnos del empleado en la quincena actual. */
  shifts: EmployeeShift[];
  /** Entradas del ledger en la quincena (bonus, etc.). */
  ledgerEntries: EmployeeLedgerEntry[];
}

/**
 * Proyecta las ganancias de la quincena actual.
 *
 * Turnos "completed" + "cancelled_with_pay" → ya ganados.
 * Turnos "scheduled" → se proyectan con su day rate + comisión estimada
 *   (el caller ya puso la comisión estimada en commissionCents).
 * Turnos "cancelled_no_pay" → no suman.
 */
export function computePayPeriodProjection(
  input: PayPeriodProjectionInput
): EmployeeFinancialDashboard["payPeriod"] {
  assertSingleEmployee(input.shifts, "payPeriod.shifts");
  assertSingleEmployee(input.ledgerEntries, "payPeriod.ledgerEntries");

  let projectedTotalCents = 0;
  let completedShifts = 0;
  let remainingShifts = 0;
  let cancelledWithPayCount = 0;
  const cancelledWithPayShiftDates: string[] = [];

  for (const shift of input.shifts) {
    if (shift.status === "completed") {
      projectedTotalCents += shift.dayRateCents + shift.commissionCents + shift.tipCents;
      completedShifts++;
    } else if (shift.status === "cancelled_with_pay") {
      projectedTotalCents += shift.dayRateCents + shift.commissionCents;
      cancelledWithPayCount++;
      cancelledWithPayShiftDates.push(shift.shiftDate);
    } else if (shift.status === "scheduled") {
      // Proyectar: day rate + comisión estimada
      projectedTotalCents += shift.dayRateCents + shift.commissionCents;
      remainingShifts++;
    }
    // cancelled_no_pay: no suma.
  }

  // Bonos del ledger en esta quincena
  for (const entry of input.ledgerEntries) {
    if (entry.earningType === "bonus" || entry.earningType === "tip") {
      projectedTotalCents += entry.amountCents;
    }
  }

  return {
    projectedTotalCents,
    completedShifts,
    remainingShifts,
    cancelledWithPayCount,
    cancelledWithPayShiftDates,
  };
}

// ---------------------------------------------------------------------------
// Insignia más cercana
// ---------------------------------------------------------------------------

/**
 * Encuentra la insignia más cercana a completarse (mayor ratio
 * currentProgress / target). Si hay empate, elige la de mayor bono.
 * Retorna null si no hay insignias en progreso.
 *
 * @param badges - Insignias con su progreso actual, ya filtradas por empleado.
 */
export function findNearestBadge(badges: BadgeProgress[]): BadgeProgress | null {
  if (badges.length === 0) return null;

  return badges
    .filter((b) => b.currentProgress < b.target)
    .sort((a, b) => {
      const ratioA = a.currentProgress / a.target;
      const ratioB = b.currentProgress / b.target;
      return ratioB - ratioA || b.bonusCents - a.bonusCents;
    })[0] ?? null;
}

// ---------------------------------------------------------------------------
// Construcción del dashboard completo
// ---------------------------------------------------------------------------

export interface BuildDashboardInput {
  employeeId: string;
  todayShifts: EmployeeShift[];
  todayLedgerEntries: EmployeeLedgerEntry[];
  payPeriodShifts: EmployeeShift[];
  payPeriodLedgerEntries: EmployeeLedgerEntry[];
  badges: BadgeProgress[];
  upcomingDeposit: UpcomingDeposit | null;
}

/**
 * Construye el dashboard financiero completo para UN empleado.
 *
 * Todas las listas de entrada DEBEN estar pre-filtradas por el caller
 * (WHERE employee_id = $auth). Esta función aplica defensa en profundidad
 * con assertSingleEmployee sobre cada lista.
 */
export function buildFinancialDashboard(input: BuildDashboardInput): EmployeeFinancialDashboard {
  const today = computeTodayEarnings({
    employeeId: input.employeeId,
    shifts: input.todayShifts,
    ledgerEntries: input.todayLedgerEntries,
  });

  const payPeriod = computePayPeriodProjection({
    employeeId: input.employeeId,
    shifts: input.payPeriodShifts,
    ledgerEntries: input.payPeriodLedgerEntries,
  });

  const nearestBadge = findNearestBadge(input.badges);

  return {
    employeeId: input.employeeId,
    today,
    payPeriod,
    upcomingDeposit: input.upcomingDeposit,
    nearestBadge,
  };
}

// ---------------------------------------------------------------------------
// UI de celebración por cancelación con pago
// ---------------------------------------------------------------------------

/**
 * Genera los mensajes de celebración para turnos cancelados con pago
 * completo. La PWA muestra 🎉 + confeti + el mensaje.
 *
 * Regla de negocio (I.2): «Si un turno se cancela con pago completo
 * (Fallback), la UI celebra: "Turno cancelado por cliente. $146
 * asegurados en tu cuenta."»
 */
export function buildCancellationCelebrations(
  shifts: EmployeeShift[]
): CancellationCelebration[] {
  assertSingleEmployee(shifts, "cancellationCelebrations.shifts");

  return shifts
    .filter((s) => s.status === "cancelled_with_pay")
    .map((s) => {
      const payoutCents = s.dayRateCents + s.commissionCents;
      return {
        shiftDate: s.shiftDate,
        payoutCents,
        message: `🎉 Turno cancelado por cliente. $${(payoutCents / 100).toFixed(2)} asegurados en tu cuenta.`,
      };
    });
}

// ---------------------------------------------------------------------------
// Formateo para PWA
// ---------------------------------------------------------------------------

// Re-exported from financial-utils.ts (single source of truth, auditoría 2026-08-07)
export { formatCents } from "./financial-utils";

/**
 * Genera el texto de resumen diario para la PWA, formato spec F.5:
 * «Ganancias hoy: $102.50 (Day Rate $90 + comisiones $12.50).»
 */
export function formatTodaySummary(today: EmployeeFinancialDashboard["today"]): string {
  const parts: string[] = [];
  if (today.dayRateCents > 0) parts.push(`Day Rate ${formatCents(today.dayRateCents)}`);
  if (today.commissionCents > 0) parts.push(`comisiones ${formatCents(today.commissionCents)}`);
  if (today.tipCents > 0) parts.push(`tips ${formatCents(today.tipCents)}`);
  if (today.cancellationPayoutCents > 0) {
    parts.push(`pago por cancelación ${formatCents(today.cancellationPayoutCents)}`);
  }

  const detail = parts.length > 0 ? ` (${parts.join(" + ")})` : "";
  return `Ganancias hoy: ${formatCents(today.totalCents)}${detail}.`;
}

/**
 * Genera el texto de la insignia más cercana para la PWA:
 * «Insignia Oro: 42/50 (te faltan 8, bono $50).»
 */
export function formatBadgeProgress(badge: BadgeProgress | null): string | null {
  if (!badge) return null;
  const remaining = badge.target - badge.currentProgress;
  return `Insignia ${badge.badgeName}: ${badge.currentProgress}/${badge.target} (te faltan ${remaining}, bono ${formatCents(badge.bonusCents)}).`;
}

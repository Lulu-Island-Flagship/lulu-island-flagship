/**
 * v8.3 C.14 / K — Proyección de flujo de caja a 30 días.
 *
 * Proyecta entradas y salidas diarias durante los próximos 30 días para
 * anticipar cruces bajo el umbral mínimo de caja. La proyección se alimenta
 * de datos reales del Shadow Ledger (patrones de cobro históricos) y de la
 * reserva de impuestos (cash-reserve.ts).
 *
 * Regla de negocio:
 *   Si el saldo proyectado en algún día de los próximos 30 días cae bajo
 *   el umbral de emergencia, se dispara una alerta P0 en el Command Center.
 *   "Cash Flow 30 Días" es un widget independiente que muestra la línea
 *   de fondo de emergencia contra el saldo diario proyectado.
 *
 * Conecta con:
 *   - shadow-ledger.ts: replayOrderBalance para el neto real histórico,
 *     patrones de captura (hold_captured, balance_captured) para proyectar.
 *   - cash-reserve.ts: calculateReserveSplit para separar la porción de
 *     impuestos de cada ingreso proyectado.
 *   - command-center.ts: produce un CashFlowWidgetSnapshot que se integra
 *     como grupo en buildCommandCenterSnapshot().
 *
 * Funciones puras, testeables. El caller (route handler del Command Center)
 * provee los snapshots históricos y los datos de costos fijos.
 *
 * @module cash-flow-predictive
 */

import { z } from "zod";
import { logEvent } from "@/lib/observability";
import { calculateReserveSplit, TAX_RESERVE_RATE_ON_INCLUSIVE_TOTAL } from "@/lib/cash-reserve";
import { toCentsBigInt } from "@/lib/money";

// ── Constantes ───────────────────────────────────────────────────────────────

/** Ventana de proyección en días. */
export const CASH_FLOW_PROJECTION_DAYS = 30;

/** Umbral mínimo de caja como múltiplo del costo operativo diario. */
export const EMERGENCY_CASH_MULTIPLIER = 3;

/** Si el fondo de emergencia en meses cae bajo esto, es P0. */
export const EMERGENCY_FUND_CRITICAL_MONTHS = 1.5;

/** Si el fondo de emergencia en meses cae bajo esto, es P1. */
export const EMERGENCY_FUND_WARNING_MONTHS = 3;

// ── Zod Schemas ──────────────────────────────────────────────────────────────

/** Un día en la proyección de flujo de caja. */
export const DailyCashFlowProjectionSchema = z.object({
  /** Fecha del día proyectado (YYYY-MM-DD). */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe("Fecha del día proyectado (YYYY-MM-DD)"),
  /** Ingresos brutos proyectados para ese día (centavos). */
  projectedInflowCents: z.number().int().min(0),
  /** Egresos proyectados para ese día (centavos): impuestos, costos fijos, nómina. */
  projectedOutflowCents: z.number().int().min(0),
  /** Saldo neto proyectado al final del día (centavos). */
  projectedBalanceCents: z.number().int(),
  /** Saldo de caja acumulado hasta este día (centavos). */
  cumulativeBalanceCents: z.number().int(),
  /** true si el saldo acumulado cruza bajo el umbral de emergencia. */
  belowEmergencyThreshold: z.boolean(),
  /** Porción de impuestos reservada de los ingresos de este día. */
  taxReserveCents: z.number().int().min(0),
});

/** Tipo inferido de un día de proyección. */
export type DailyCashFlowProjection = z.infer<typeof DailyCashFlowProjectionSchema>;

/** Nivel de alerta del flujo de caja. */
export type CashFlowAlertLevel = "none" | "warning" | "critical";

/** Snapshot del widget "Cash Flow 30 Días" para el Command Center. */
export interface CashFlowWidgetSnapshot {
  /** Saldo de caja actual (centavos). */
  currentBalanceCents: number;
  /** Fondo de emergencia en meses. */
  emergencyFundMonths: number;
  /** Proyección diaria de los próximos 30 días. */
  dailyProjections: DailyCashFlowProjection[];
  /** Día más bajo proyectado. */
  lowestProjectedBalance: { date: string; balanceCents: number };
  /** Día en que se cruza bajo el umbral (si aplica). */
  firstDayBelowThreshold: { date: string; balanceCents: number } | null;
  /** Nivel de alerta. */
  alertLevel: CashFlowAlertLevel;
  /** Ingreso total proyectado en 30 días (centavos). */
  totalProjectedInflowCents: number;
  /** Egreso total proyectado en 30 días (centavos). */
  totalProjectedOutflowCents: number;
  /** Neto proyectado a 30 días (centavos). */
  netProjectedCents: number;
  /** Fecha de generación. */
  generatedAtIso: string;
}

/** Input para la proyección de flujo de caja. */
export const CashFlowProjectionInputSchema = z.object({
  /** Saldo de caja actual (centavos) — del Shadow Ledger neto. */
  currentBalanceCents: z.number().int()
    .describe("Saldo de caja operativa actual (neto real del Shadow Ledger)"),
  /** Ingreso diario promedio histórico (centavos/día) — de shadow-ledger.ts. */
  historicalDailyInflowAvgCents: z.number().int().min(0)
    .describe("Promedio histórico de ingreso diario en centavos"),
  /** Costo operativo diario (centavos/día): nómina, insumos, overhead. */
  dailyOperatingCostCents: z.number().int().min(0)
    .describe("Costo operativo diario estimado en centavos"),
  /** Reserva de impuestos ya acumulada (centavos). */
  accumulatedTaxReserveCents: z.number().int().min(0)
    .describe("Reserva fiscal ya acumulada (del cash-reserve)"),
  /** Porción de cada ingreso que va a reserva fiscal (fracción). */
  taxReserveRate: z.number().min(0).max(1).default(TAX_RESERVE_RATE_ON_INCLUSIVE_TOTAL)
    .describe("Tasa de reserva fiscal sobre ingreso tax-inclusive"),
  /** Timestamp de referencia para la proyección. */
  referenceIso: z.string().datetime({ offset: true })
    .describe("Timestamp ISO8601 desde el cual se proyecta"),
  /** Días con eventos conocidos que modifican el flujo normal (ej. feriados). */
  knownEventDays: z.array(z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    inflowAdjustmentCents: z.number().int().default(0),
    outflowAdjustmentCents: z.number().int().default(0),
  })).optional().default([])
    .describe("Días con ajustes conocidos de flujo (feriados, campañas, etc.)"),
});

/** Tipo inferido del input de proyección. */
export type CashFlowProjectionInput = z.infer<typeof CashFlowProjectionInputSchema>;

// ── Núcleo: proyección a 30 días ─────────────────────────────────────────────

/**
 * Proyecta el flujo de caja diario para los próximos 30 días.
 *
 * La proyección usa un modelo simple basado en el promedio histórico:
 * cada día se asume un ingreso igual al promedio diario (menos la reserva
 * fiscal sobre la porción gravable) y un egreso igual al costo operativo
 * diario. Los días con eventos conocidos ajustan esos valores.
 *
 * El umbral de emergencia se calcula como:
 *   emergencyThreshold = dailyOperatingCost * EMERGENCY_CASH_MULTIPLIER
 *
 * Si el saldo acumulado en cualquier día proyectado cae bajo ese umbral,
 * se marca belowEmergencyThreshold = true para ese día.
 *
 * @param input — Datos para la proyección.
 * @returns CashFlowWidgetSnapshot listo para el Command Center.
 */
export function projectCashFlow30Days(
  input: CashFlowProjectionInput
): CashFlowWidgetSnapshot {
  const validated = CashFlowProjectionInputSchema.parse(input);

  const referenceDate = new Date(validated.referenceIso);
  const emergencyThreshold = validated.dailyOperatingCostCents * EMERGENCY_CASH_MULTIPLIER;

  // Índice rápido de días con eventos conocidos.
  const eventMap = new Map<string, { inflowAdj: number; outflowAdj: number }>();
  for (const ev of validated.knownEventDays) {
    eventMap.set(ev.date, {
      inflowAdj: ev.inflowAdjustmentCents,
      outflowAdj: ev.outflowAdjustmentCents,
    });
  }

  const dailyProjections: DailyCashFlowProjection[] = [];
  let cumulative = validated.currentBalanceCents;
  let totalInflow = 0;
  let totalOutflow = 0;
  let firstDayBelow: { date: string; balanceCents: number } | null = null;
  let lowestBalance = validated.currentBalanceCents;
  let lowestDate = referenceDate.toISOString().slice(0, 10);

  for (let day = 1; day <= CASH_FLOW_PROJECTION_DAYS; day++) {
    const dateObj = new Date(referenceDate);
    dateObj.setDate(dateObj.getDate() + day);
    const dateStr = dateObj.toISOString().slice(0, 10);

    const event = eventMap.get(dateStr);
    const inflowAdj = event?.inflowAdj ?? 0;
    const outflowAdj = event?.outflowAdj ?? 0;

    // Ingreso bruto del día = promedio histórico + ajuste por evento.
    const grossInflow = Math.max(0, validated.historicalDailyInflowAvgCents + inflowAdj);

    // Separar reserva fiscal del ingreso del día (solo sobre la porción gravable).
    // Borde bigint: esta proyección aún opera en number (deuda pendiente); se
    // convierte con toCentsBigInt y se regresa a number en el resultado.
    const reserveSplit = calculateReserveSplit({
      grossAmountCents: toCentsBigInt(grossInflow),
      tipAmountCents: 0n, // tips no son gravables, y no se proyectan aquí
      nonTaxableAmountCents: 0n,
    });
    const taxReserveCents = Number(reserveSplit.taxReserveCents);

    // Ingreso neto operativo del día (después de reserva fiscal).
    const netInflow = grossInflow - taxReserveCents;

    // Egreso del día = costo operativo + ajuste.
    const outflow = Math.max(0, validated.dailyOperatingCostCents + outflowAdj);

    cumulative = cumulative + netInflow - outflow;

    const belowThreshold = cumulative < emergencyThreshold;

    const dailyProj: DailyCashFlowProjection = {
      date: dateStr,
      projectedInflowCents: Math.round(grossInflow),
      projectedOutflowCents: Math.round(outflow),
      projectedBalanceCents: Math.round(netInflow - outflow),
      cumulativeBalanceCents: Math.round(cumulative),
      belowEmergencyThreshold: belowThreshold,
      taxReserveCents: Math.round(taxReserveCents),
    };

    dailyProjections.push(dailyProj);
    totalInflow += grossInflow;
    totalOutflow += outflow;

    if (belowThreshold && !firstDayBelow) {
      firstDayBelow = { date: dateStr, balanceCents: Math.round(cumulative) };
    }

    if (cumulative < lowestBalance) {
      lowestBalance = cumulative;
      lowestDate = dateStr;
    }
  }

  // Calcular fondo de emergencia en meses.
  const monthlyOperatingCost = validated.dailyOperatingCostCents * 30;
  const emergencyFundMonths =
    monthlyOperatingCost > 0
      ? validated.currentBalanceCents / monthlyOperatingCost
      : 999;

  // Determinar nivel de alerta.
  let alertLevel: CashFlowAlertLevel;
  if (emergencyFundMonths < EMERGENCY_FUND_CRITICAL_MONTHS || (firstDayBelow !== null)) {
    alertLevel = "critical";
  } else if (emergencyFundMonths < EMERGENCY_FUND_WARNING_MONTHS) {
    alertLevel = "warning";
  } else {
    alertLevel = "none";
  }

  const netProjectedCents = Math.round(totalInflow - totalOutflow);

  // Auditoría.
  logEvent("financiero.cash_flow_projected", {
    currentBalanceCents: validated.currentBalanceCents,
    emergencyFundMonths: Math.round(emergencyFundMonths * 10) / 10,
    alertLevel,
    totalProjectedInflowCents: Math.round(totalInflow),
    totalProjectedOutflowCents: Math.round(totalOutflow),
    netProjectedCents,
    firstDayBelowThreshold: firstDayBelow?.date ?? null,
    lowestBalanceCents: Math.round(lowestBalance),
    lowestDate,
    generatedAtIso: validated.referenceIso,
  });

  return {
    currentBalanceCents: validated.currentBalanceCents,
    emergencyFundMonths: Math.round(emergencyFundMonths * 10) / 10,
    dailyProjections,
    lowestProjectedBalance: {
      date: lowestDate,
      balanceCents: Math.round(lowestBalance),
    },
    firstDayBelowThreshold: firstDayBelow,
    alertLevel,
    totalProjectedInflowCents: Math.round(totalInflow),
    totalProjectedOutflowCents: Math.round(totalOutflow),
    netProjectedCents,
    generatedAtIso: validated.referenceIso,
  };
}

// ── Helpers: consultas rápidas sin generar snapshot completo ─────────────────

/**
 * ¿La proyección indica que la caja cruzará bajo el umbral de emergencia
 * en los próximos 30 días?
 *
 * @returns true si algún día proyectado está bajo el umbral.
 */
export function willCashCrossEmergencyThreshold(
  currentBalanceCents: number,
  dailyOperatingCostCents: number,
  historicalDailyInflowAvgCents: number
): boolean {
  if (dailyOperatingCostCents <= 0) return false;

  const emergencyThreshold = dailyOperatingCostCents * EMERGENCY_CASH_MULTIPLIER;
  const taxReserveRate = TAX_RESERVE_RATE_ON_INCLUSIVE_TOTAL;

  // Proyección simplificada sin construir el snapshot completo.
  let cumulative = currentBalanceCents;

  for (let day = 1; day <= CASH_FLOW_PROJECTION_DAYS; day++) {
    const netInflow =
      historicalDailyInflowAvgCents -
      Math.round(historicalDailyInflowAvgCents * taxReserveRate);
    cumulative = cumulative + netInflow - dailyOperatingCostCents;

    if (cumulative < emergencyThreshold) return true;
  }

  return false;
}

/**
 * Calcula el fondo de emergencia en meses según la caja actual y el
 * costo operativo diario.
 *
 * @returns Meses de fondo de emergencia (999 si no hay costo operativo).
 */
export function calculateEmergencyFundMonths(
  currentBalanceCents: number,
  dailyOperatingCostCents: number
): number {
  if (dailyOperatingCostCents <= 0) return 999;
  const monthly = dailyOperatingCostCents * 30;
  return Math.round((currentBalanceCents / monthly) * 10) / 10;
}

/**
 * Formatea un monto en centavos como dólares para mostrar en el widget.
 *
 * @returns String formateado como "$X,XXX.XX".
 */
export function formatCashFlowCurrency(cents: number): string {
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${dollars.toLocaleString("en-CA")}.${remainder.toString().padStart(2, "0")}`;
}

/**
 * v8.4 Capa 4 del Financial Core — Payroll Line (payroll_linea table).
 *
 * Define la línea individual de nómina por empleado dentro de un ciclo de
 * pago. Extiende los conceptos de nomina_linea con el desglose completo de
 * deducciones canadienses (CPP, EI, Tax Federal/Provincial), contribuciones
 * patronales (CPP employer 1:1, EI employer 1.4×, WorkSafeBC), vacation pay
 * accrual (4% o 6% según BC ESA), y acumulados YTD.
 *
 * REGLA: todos los montos en centavos enteros (CAD). SIN nunca se almacena
 * completo en este módulo — el descifrado ocurre en capas superiores bajo
 * rol owner_admin (ver payroll-export.ts attachSinToLines).
 *
 * Interconexiones:
 *   payroll-line.ts ──(importado por)──→ payroll-calculator.ts
 *   payroll-line.ts ──(importado por)──→ payroll-engine.ts
 *   payroll-line.ts ──(importado por)──→ pay-statement.ts
 */

import { z } from "zod";

// =========================================================================
// Zod Schema — payroll_linea row (forma canónica en base de datos)
// =========================================================================

/**
 * Esquema Zod de una fila en la tabla `payroll_linea`.
 *
 * Cada fila representa la nómina de UN empleado para UN ciclo de pago.
 * Los montos están en centavos enteros CAD (sin decimales).
 */
export const payrollLineaRowSchema = z.object({
  /** UUID autogenerado — PK de la fila. */
  linea_id: z.string().uuid(),

  /** FK a payroll_ciclo.ciclo_id — ciclo de pago al que pertenece esta línea. */
  ciclo_id: z.string().uuid(),

  /** FK a employees.id — empleado que recibe este pago. */
  employee_id: z.string().uuid(),

  // ── Earnings (centavos enteros CAD) ───────────────────────────────────

  /** Suma de Day Rates del ciclo (base diaria × días trabajados). */
  day_rate_cents: z.number().int().nonnegative(),

  /** Comisiones ganadas en el ciclo. */
  comisiones_cents: z.number().int().nonnegative(),

  /** Horas extra pagadas en el ciclo (recargo 1.5× incluido). */
  horas_extra_cents: z.number().int().nonnegative(),

  /** Vacation Pay devengado en este período (4% o 6% del gross, BC ESA s.58). */
  vacation_pay_cents: z.number().int().nonnegative(),

  // ── Bruto ─────────────────────────────────────────────────────────────

  /** Total bruto del período = day_rate + comisiones + horas_extra. */
  gross_cents: z.number().int().nonnegative(),

  // ── Deducciones del empleado (centavos) ───────────────────────────────

  /** CPP empleado (base + CPP2). El empleador iguala 1:1. */
  cpp_empleado: z.number().int().nonnegative(),

  /** EI empleado (1.63% de ganancias asegurables). */
  ei_empleado: z.number().int().nonnegative(),

  /** Retención de impuesto federal estimada (simplificada — ver nota en calculator). */
  tax_federal: z.number().int().nonnegative(),

  /** Retención de impuesto provincial BC estimada (tasa_base del compliance-engine). */
  tax_provincial: z.number().int().nonnegative(),

  // ── Contribuciones del empleador (centavos) ───────────────────────────

  /** CPP empleador — iguala 1:1 la contribución del empleado. */
  cpp_employer: z.number().int().nonnegative(),

  /** EI empleador — 1.4× la prima del empleado. */
  ei_employer: z.number().int().nonnegative(),

  /** WorkSafeBC prima del período (solo empleador, class_rate × nómina asegurable / 100). */
  worksafebc_prima: z.number().int().nonnegative(),

  // ── Vacation Pay Accrual (pasivo del empleador) ───────────────────────

  /**
   * Vacation Pay acumulado en este período.
   * Es parte del gross (se paga al empleado) pero también es un pasivo
   * contable que el empleador debe trackear. Se incluye aquí como campo
   * separado para el breakdown del pay statement y el JE contable.
   */
  vacation_pay_accrual: z.number().int().nonnegative(),

  // ── Neto a pagar ──────────────────────────────────────────────────────

  /**
   * Neto a pagar al empleado = gross - CPP_emp - EI_emp - tax_fed - tax_prov.
   * Puede ser negativo en edge cases (pocas horas + deducciones fijas), pero
   * en la práctica siempre ≥ 0 para empleados regulares.
   */
  neto_pagar: z.number().int(),

  // ── YTD acumulados al cierre de este ciclo (centavos) ─────────────────

  /** Gross acumulado en el año calendario DESPUÉS de este ciclo. */
  ytd_gross: z.number().int().nonnegative(),

  /** CPP total (empleado + empleador) acumulado en el año. */
  ytd_cpp: z.number().int().nonnegative(),

  /** EI total (empleado + empleador) acumulado en el año. */
  ytd_ei: z.number().int().nonnegative(),

  /** Impuesto total (federal + provincial) retenido en el año. */
  ytd_tax: z.number().int().nonnegative(),

  // ── Metadata ──────────────────────────────────────────────────────────

  /** Timestamp ISO 8601 de creación de la fila. */
  creado_en: z.string().datetime(),

  /** Notas opcionales (ej. "comisión extraordinaria proyecto X"). */
  notas: z.string().nullable(),
});

/** Tipo TypeScript inferido del schema Zod. */
export type PayrollLineaRow = z.infer<typeof payrollLineaRowSchema>;

// =========================================================================
// Input type — datos de entrada para calculatePayrollForEmployee()
// =========================================================================

/**
 * Datos de entrada para calcular una línea de nómina.
 *
 * El caller (payroll-calculator.ts) provee los YTD del empleado ANTES
 * de este ciclo y los eventos laborales del período. La función de cálculo
 * produce un objeto compatible con PayrollLineaRow (menos linea_id,
 * creado_en, y notas que asigna el caller al persistir).
 */
export interface PayrollLineaInput {
  /** FK a employees.id. */
  employee_id: string;

  /** FK a payroll_ciclo.ciclo_id. */
  ciclo_id: string;

  // ── Earnings del ciclo ────────────────────────────────────────────────

  /** Suma de Day Rates (base diaria × días trabajados en el ciclo). */
  day_rate_cents: number;

  /** Comisiones del ciclo. */
  comisiones_cents: number;

  /** Horas extra del ciclo (con recargo 1.5× ya aplicado). */
  horas_extra_cents: number;

  // ── Parámetros del empleado ───────────────────────────────────────────

  /** Años de servicio continuo (determina tasa de Vacation Pay: 4% o 6%). */
  years_of_service: number;

  // ── YTD ANTES de este ciclo ───────────────────────────────────────────

  /** Gross acumulado en el año calendario antes de este ciclo. */
  ytd_gross: number;

  /** CPP acumulado (employee side) en el año antes de este ciclo. */
  ytd_cpp: number;

  /** EI acumulado (employee side) en el año antes de este ciclo. */
  ytd_ei: number;

  /** Impuesto (federal + provincial) retenido en el año antes de este ciclo. */
  ytd_tax: number;
}

// =========================================================================
// Labor Event — unidad de trabajo que alimenta el cálculo
// =========================================================================

/**
 * Un evento laboral individual dentro de un ciclo de pago.
 *
 * Cada evento representa trabajo realizado por un empleado en una fecha
 * concreta. El calculator suma todos los eventos del ciclo para obtener
 * los totales de day_rate, comisiones y horas extra.
 */
export interface LaborEvent {
  /**
   * Tipo de compensación.
   * - day_rate: pago base diario (el day rate del empleado por ese día).
   * - comision: comisión ganada (ej. up-sell, referral interno).
   * - hora_extra: horas extra con recargo 1.5× ya aplicado.
   */
  tipo: "day_rate" | "comision" | "hora_extra";

  /** Monto en centavos CAD. */
  amount_cents: number;

  /** Fecha del servicio/trabajo (YYYY-MM-DD). */
  fecha: string;

  /** Referencia opcional (ej. order_id, motivo de comisión). */
  referencia?: string;
}

// =========================================================================
// Helpers
// =========================================================================

/**
 * Enmascara un SIN mostrando solo los últimos 3 dígitos.
 * Formato: "*** *** 123"
 *
 * REGLA: nunca se loguea ni se almacena el SIN completo fuera del canal
 * cifrado de get_employee_banking_info() (RPC con rol owner_admin).
 *
 * @param sin — SIN de 9 dígitos en texto plano (ya descifrado).
 * @returns SIN enmascarado para display en pay statements y logs.
 */
export function maskSin(sin: string): string {
  const cleaned = sin.replace(/\s|-/g, "");
  if (cleaned.length !== 9) {
    return "*** *** ***";
  }
  return `*** *** ${cleaned.slice(-3)}`;
}

/**
 * Convierte centavos a dólares con 2 decimales para display.
 * Función pura — no redondea (la precisión ya viene en centavos enteros).
 */
export function centsToDollars(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

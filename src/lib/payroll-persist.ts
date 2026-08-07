/**
 * payroll-persist.ts — Persistencia de payroll_entries
 *
 * v8.3 H4 (auditoría 2026-08-06): el subsistema payroll (~5,000 líneas)
 * calcula nómina correctamente pero NUNCA persistía el resultado en la
 * tabla payroll_entries. Este módulo cierra esa brecha: toma los datos
 * disponibles al momento de cierre de servicio (employee.day_rate,
 * estimated_minutes, etc.) y crea una entrada de nómina en estado
 * "pending", lista para ser aprobada en el ciclo de payroll.
 *
 * La entrada se crea con:
 *  - QC score = null (aún no evaluado)
 *  - rework = 0 (aún no determinado)
 *  - status = "pending"
 *
 * Campos QC/rework se actualizan después vía admin cuando corresponda.
 *
 * Idempotente: si ya existe una entrada para el mismo (employee_id, order_id),
 * no la duplica.
 *
 * Convención de unidades:
 *  - employees.day_rate está en DÓLARES (INTEGER, ej. 200 = $200/día)
 *  - calculatePayroll() espera dayRate en CENTAVOS
 *  - payroll_entries.day_rate y todos los montos (base_amount, gross_amount,
 *    etc.) están en CENTAVOS (INTEGER)
 *  - Este módulo hace la conversión: dayRateCents = dayRateDollars * 100
 */

import { calculatePayroll, DEFAULT_SERVICE_MINUTES } from "./payroll";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
import type { SupabaseClient } from "@supabase/supabase-js";

export interface InsertPayrollEntryInput {
  /** Cliente Supabase autenticado (sesión del empleado o service_role). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, "public", any>;
  /** UUID del empleado (employees.id). */
  employeeId: string;
  /** UUID de la orden de servicio (orders.id). */
  orderId: string;
  /** UUID de la asignación (assignments.id), opcional. */
  assignmentId?: string;
  /** Day rate del empleado en DÓLARES (employees.day_rate, INTEGER). */
  dayRateDollars: number;
  /** Minutos estimados del servicio (default 480 = 8h). */
  estimatedServiceMinutes?: number;
  /** Minutos de rework (default 0). */
  reworkMinutes?: number;
  /** Score QC 0-100 (default undefined → null en DB). */
  qcScore?: number;
  /** Minutos de overtime registrados (default 0). */
  overtimeMinutes?: number;
  /** Monto de overtime en centavos (default 0). */
  overtimeAmount?: number;
}

export interface InsertPayrollEntryResult {
  created: boolean;
  id?: string;
  reason?: string;
  error?: string;
}

/**
 * Inserta una entrada de nómina en payroll_entries.
 *
 * Es idempotente por (employee_id, order_id): si ya existe una entrada
 * activa (deleted_at IS NULL), no crea una nueva.
 *
 * @returns InsertPayrollEntryResult con created=true y el id si se insertó,
 *   o created=false con el motivo si ya existía o hubo error.
 */
export async function insertPayrollEntry(
  input: InsertPayrollEntryInput
): Promise<InsertPayrollEntryResult> {
  // 1. Idempotencia: verificar si ya existe
  const { data: existing, error: checkError } = await input.supabase
    .from("payroll_entries")
    .select("id")
    .eq("employee_id", input.employeeId)
    .eq("order_id", input.orderId)
    .is("deleted_at", null)
    .maybeSingle();

  if (checkError) {
    console.error("payroll-persist: check error", checkError);
    return { created: false, error: checkError.message };
  }

  if (existing) {
    return { created: false, id: existing.id, reason: "already exists" };
  }

  // 2. Convertir day_rate de dólares a centavos
  const dayRateCents = Math.round(input.dayRateDollars * 100);

  // 3. Calcular nómina con los datos disponibles
  const estMinutes = input.estimatedServiceMinutes ?? DEFAULT_SERVICE_MINUTES;
  const calc = calculatePayroll({
    dayRate: dayRateCents,
    estimatedServiceMinutes: estMinutes,
    reworkMinutes: input.reworkMinutes ?? 0,
    qcScore: input.qcScore,
  });

  // 4. Insertar en payroll_entries
  const { data, error: insertError } = await input.supabase
    .from("payroll_entries")
    .insert({
      employee_id: input.employeeId,
      order_id: input.orderId,
      assignment_id: input.assignmentId ?? null,
      day_rate: dayRateCents,
      estimated_service_minutes: estMinutes,
      rework_minutes: input.reworkMinutes ?? 0,
      qc_score: input.qcScore ?? null,
      base_amount: calc.baseAmount,
      qc_bonus_amount: calc.qcBonusAmount,
      qc_penalty_amount: calc.qcPenaltyAmount,
      rework_paid_minutes: calc.reworkPaidMinutes,
      rework_amount: calc.reworkAmount,
      hourly_equivalent: calc.hourlyEquivalent,
      minimum_wage_adjustment: calc.minimumWageAdjustment,
      gross_amount: calc.grossAmount,
      overtime_minutes: input.overtimeMinutes ?? 0,
      overtime_amount: input.overtimeAmount ?? 0,
      status: "pending",
    })
    .select("id")
    .single();

  if (insertError) {
    console.error("payroll-persist: insert error", insertError);
    return { created: false, error: insertError.message };
  }

  return { created: true, id: data.id };
}

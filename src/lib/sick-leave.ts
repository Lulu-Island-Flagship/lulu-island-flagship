/**
 * v8.3 — Días de enfermedad (BC ESA Parte 5.1, "Personal Illness or
 * Injury Leave"): tras 90 días continuos de empleo, 5 días PAGADOS por
 * año calendario + 3 días adicionales NO pagados (pero con protección de
 * empleo) por año calendario. Antes de los 90 días, una ausencia por
 * enfermedad no es una entitlement estatutaria -- queda a discreción del
 * empleador (se documenta igual, pero sin pago automático).
 *
 * Pedido explícito del negocio: el empleado debe poder reportar una
 * ausencia con una excusa simple en texto ("tengo gripa") O subiendo una
 * nota médica -- la ley NO exige nota médica para las primeras ausencias
 * cortas (reforma reciente limita cuándo el empleador puede exigirla),
 * así que ambas vías son válidas y quedan documentadas por igual; la nota
 * médica es evidencia adicional, no un requisito de entrada.
 */

export const SICK_LEAVE_MIN_EMPLOYMENT_DAYS = 90;
export const PAID_SICK_DAYS_PER_YEAR = 5;
export const UNPAID_PROTECTED_SICK_DAYS_PER_YEAR = 3;

export type SickLeaveReasonType = "self_reported" | "medical_note";
export type SickLeavePayType = "paid" | "unpaid_protected" | "discretionary";

export interface SickLeaveEligibilityInput {
  daysEmployedContinuous: number;
  paidDaysUsedThisYear: number;
  unpaidProtectedDaysUsedThisYear: number;
}

export interface SickLeaveEligibilityResult {
  payType: SickLeavePayType;
  reason: string;
}

export function decideSickLeaveEligibility(input: SickLeaveEligibilityInput): SickLeaveEligibilityResult {
  const { daysEmployedContinuous, paidDaysUsedThisYear, unpaidProtectedDaysUsedThisYear } = input;

  if (daysEmployedContinuous < SICK_LEAVE_MIN_EMPLOYMENT_DAYS) {
    return {
      payType: "discretionary",
      reason: `Menos de ${SICK_LEAVE_MIN_EMPLOYMENT_DAYS} días de empleo continuo -- no aplica todavía la entitlement estatutaria (BC ESA); queda a discreción del empleador.`,
    };
  }

  if (paidDaysUsedThisYear < PAID_SICK_DAYS_PER_YEAR) {
    return {
      payType: "paid",
      reason: `Día pagado ${paidDaysUsedThisYear + 1} de ${PAID_SICK_DAYS_PER_YEAR} disponibles este año calendario.`,
    };
  }

  if (unpaidProtectedDaysUsedThisYear < UNPAID_PROTECTED_SICK_DAYS_PER_YEAR) {
    return {
      payType: "unpaid_protected",
      reason: `Los ${PAID_SICK_DAYS_PER_YEAR} días pagados ya se usaron este año. Día no pagado ${unpaidProtectedDaysUsedThisYear + 1} de ${UNPAID_PROTECTED_SICK_DAYS_PER_YEAR} con protección de empleo.`,
    };
  }

  return {
    payType: "discretionary",
    reason: `Ya se usaron los ${PAID_SICK_DAYS_PER_YEAR} días pagados y los ${UNPAID_PROTECTED_SICK_DAYS_PER_YEAR} no pagados con protección de este año calendario -- cualquier día adicional queda a discreción del empleador.`,
  };
}

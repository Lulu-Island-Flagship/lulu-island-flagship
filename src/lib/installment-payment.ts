/**
 * v8.3 E2.10 — Pago fraccionado 50/50 para órdenes con total > $500.
 *
 * LIMITACIÓN CONOCIDA (documentada, no un descuido): estas funciones
 * calculan elegibilidad y el desglose 50/50, pero el COBRO real de la
 * segunda mitad no está integrado al cron de captura todavía -- el flujo
 * Hold(T-72h)+Batch Capture(7PM) sigue intacto y es el que efectivamente
 * mueve dinero. `installment_second_due_at`/`installment_second_amount_cents`
 * quedan guardados en la orden como el compromiso declarado con el cliente,
 * listos para que un cron futuro los use cuando se decida modificar el flujo
 * de captura para partirlo en dos cargos reales independientes.
 */

export const INSTALLMENT_ELIGIBILITY_THRESHOLD_CENTS = 50000; // $500.00
export const INSTALLMENT_SECOND_DUE_DAYS_BEFORE_SERVICE = 7;

export function isEligibleForInstallmentPlan(orderTotalCents: number): boolean {
  return orderTotalCents > INSTALLMENT_ELIGIBILITY_THRESHOLD_CENTS;
}

export interface InstallmentSplit {
  firstInstallmentCents: number;
  secondInstallmentCents: number;
}

/** 50/50 -- si el total es impar en centavos, el primer pago absorbe el centavo extra (nunca el cliente paga de más en total). */
export function computeInstallmentSplit(orderTotalCents: number): InstallmentSplit {
  const secondInstallmentCents = Math.floor(orderTotalCents / 2);
  const firstInstallmentCents = orderTotalCents - secondInstallmentCents;
  return { firstInstallmentCents, secondInstallmentCents };
}

/**
 * Fecha límite del segundo pago: 7 días antes del servicio. Si el servicio
 * ya está a menos de 7 días (o es hoy), el segundo pago vence de inmediato
 * (`nowIso`) en vez de una fecha pasada -- nunca se declara un plazo que ya
 * venció antes de existir.
 */
export function computeInstallmentSecondDueDate(serviceDateIso: string, nowIso: string): string {
  const serviceMs = new Date(serviceDateIso).getTime();
  const dueMs = serviceMs - INSTALLMENT_SECOND_DUE_DAYS_BEFORE_SERVICE * 24 * 60 * 60 * 1000;
  const nowMs = new Date(nowIso).getTime();
  return new Date(Math.max(dueMs, nowMs)).toISOString();
}

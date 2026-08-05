/**
 * v8.3 C.10 / G.6 — Período de gracia recurrente.
 *
 * Cuando un cliente recurrente falla su pago final (captura de saldo),
 * el sistema NO cancela el servicio ni lo marca como impago inmediato.
 * En su lugar, activa un período de gracia de 15 días (GRACIA_RECURRENTE)
 * durante el cual:
 *
 *   1. El servicio YA REALIZADO se considera completado.
 *   2. El saldo pendiente se registra en el Shadow Ledger como deuda
 *      operativa (evento "grace_period_activated").
 *   3. El portal del cliente se bloquea: no puede hacer nuevas reservas
 *      hasta que liquide el saldo pendiente.
 *   4. Si el cliente paga dentro de los 15 días → gracia se cierra,
 *      portal se reabre, el registro pasa a "grace_period_resolved".
 *   5. Si pasan 15+ días sin pago → GRACIA_VENCIDA: se pausan TODAS
 *      las reservas futuras del cliente (incluso recurrentes) y se
 *      escala a intervención humana.
 *
 * Conecta con:
 *   - payment-capture-reconciliation.ts: el evento "capture_failed" que
 *     dispara el período de gracia.
 *   - batch-capture-eligibility.ts: las órdenes en gracia NO entran al
 *     Batch Capture (su saldo ya está en Shadow Ledger como deuda, no
 *     como hold pendiente de captura).
 *
 * Funciones puras, testeables. El caller (webhook de Stripe, cron de
 * gracia, ruta admin) provee los datos y aplica las decisiones.
 *
 * @module grace-period
 */

import { z } from "zod";
import { logEvent } from "@/lib/observability";

// ── Constantes ───────────────────────────────────────────────────────────────

/** Días del período de gracia desde el fallo de pago. */
export const GRACE_PERIOD_DAYS = 15;

/** Cantidad máxima de períodos de gracia antes de marcar al cliente
 *  como "crédito agotado" y requerir intervención humana irreversible. */
export const MAX_GRACE_PERIODS_BEFORE_EXHAUSTION = 3;

// ── Zod Schemas ──────────────────────────────────────────────────────────────

/** Estados posibles del período de gracia de un cliente. */
export const GracePeriodStatusSchema = z.enum([
  "normal",                // Sin período de gracia activo
  "gracia_activa",         // Período de gracia en curso (0-15 días)
  "gracia_vencida",        // 15+ días sin pago
  "gracia_resuelta",       // Pagó dentro de los 15 días
  "credito_agotado",       // 3+ períodos de gracia → intervención humana
]);

/** Tipo inferido del estado de gracia. */
export type GracePeriodStatus = z.infer<typeof GracePeriodStatusSchema>;

/** Input para evaluar el estado de gracia de un cliente. */
export const GracePeriodEvaluationInputSchema = z.object({
  /** Estado actual de gracia (null si nunca tuvo una). */
  currentStatus: GracePeriodStatusSchema.nullable(),
  /** Timestamp ISO8601 del último fallo de pago. */
  lastPaymentFailureIso: z.string().datetime({ offset: true }).nullable()
    .describe("Último fallo de captura de pago (timestamp ISO8601)"),
  /** Timestamp ISO8601 del último pago exitoso (si hubo). */
  lastSuccessfulPaymentIso: z.string().datetime({ offset: true }).nullable()
    .describe("Último pago exitoso que resolvió una gracia previa"),
  /** Saldo pendiente en Shadow Ledger (centavos). */
  outstandingBalanceCents: z.number().int().min(0)
    .describe("Saldo pendiente en Shadow Ledger para este cliente"),
  /** Cuántas veces este cliente ha entrado en período de gracia. */
  totalGracePeriodsUsed: z.number().int().min(0)
    .describe("Cantidad total de períodos de gracia usados históricamente"),
  /** Timestamp de referencia para el cálculo (normalmente now). */
  referenceIso: z.string().datetime({ offset: true })
    .describe("Timestamp ISO8601 de referencia para la evaluación"),
});

/** Tipo inferido del input de evaluación de gracia. */
export type GracePeriodEvaluationInput = z.infer<typeof GracePeriodEvaluationInputSchema>;

/** Resultado de la evaluación del período de gracia. */
export interface GracePeriodEvaluationResult {
  /** Estado determinado después de la evaluación. */
  status: GracePeriodStatus;
  /** Días transcurridos desde el último fallo de pago (0 si no aplica). */
  daysSinceLastFailure: number;
  /** Días restantes del período de gracia (0 si venció o no aplica). */
  daysRemaining: number;
  /** true si el portal del cliente debe estar bloqueado. */
  portalBlocked: boolean;
  /** true si las reservas futuras deben pausarse (incluso recurrentes). */
  futureReservationsPaused: boolean;
  /** Razón legible de la decisión. */
  reason: string;
  /** true si se debe escalar a intervención humana. */
  requiresHumanIntervention: boolean;
}

/** Evento de auditoría para el período de gracia. */
export interface GracePeriodAuditEvent {
  event_type: "financiero.grace_period_evaluated";
  previousStatus: string | null;
  newStatus: GracePeriodStatus;
  daysSinceLastFailure: number;
  daysRemaining: number;
  outstandingBalanceCents: number;
  totalGracePeriodsUsed: number;
  portalBlocked: boolean;
  futureReservationsPaused: boolean;
  evaluatedAtIso: string;
}

// ── Núcleo: evaluación del período de gracia ─────────────────────────────────

/**
 * Evalúa el estado actual del período de gracia recurrente de un cliente.
 *
 * Flujo de estados:
 *   normal → (fallo de pago) → gracia_activa
 *   gracia_activa → (pago dentro de 15d) → gracia_resuelta → normal
 *   gracia_activa → (15+ días sin pago) → gracia_vencida
 *   gracia_vencida → (pago tardío) → gracia_resuelta → normal
 *   gracia_vencida → (3er+ período de gracia) → credito_agotado
 *
 * Reglas:
 *   - Portal bloqueado SIEMPRE que haya un saldo pendiente > 0.
 *   - Reservas futuras pausadas: solo si gracia_vencida o credito_agotado.
 *   - Nunca se bloquea el portal si el saldo ya está en cero.
 *
 * @param input — Datos del cliente y su historial de gracia.
 * @returns GracePeriodEvaluationResult con la decisión y el evento de auditoría.
 */
export function evaluateGracePeriod(
  input: GracePeriodEvaluationInput
): GracePeriodEvaluationResult {
  const validated = GracePeriodEvaluationInputSchema.parse(input);

  const referenceMs = new Date(validated.referenceIso).getTime();
  const lastFailureMs = validated.lastPaymentFailureIso
    ? new Date(validated.lastPaymentFailureIso).getTime()
    : null;

  const daysSinceLastFailure = lastFailureMs
    ? Math.max(0, (referenceMs - lastFailureMs) / (1000 * 60 * 60 * 24))
    : 0;

  // Determinar el nuevo estado.
  let newStatus: GracePeriodStatus;

  // Caso 1: sin historial de gracia y sin saldo → normal.
  if (!validated.currentStatus || validated.currentStatus === "normal") {
    if (validated.outstandingBalanceCents > 0 && validated.lastPaymentFailureIso) {
      // Hay saldo pendiente con fallo de pago registrado → activar gracia.
      if (daysSinceLastFailure < GRACE_PERIOD_DAYS) {
        newStatus = "gracia_activa";
      } else {
        // Ya pasaron 15+ días → gracia vencida.
        if (validated.totalGracePeriodsUsed >= MAX_GRACE_PERIODS_BEFORE_EXHAUSTION) {
          newStatus = "credito_agotado";
        } else {
          newStatus = "gracia_vencida";
        }
      }
    } else if (validated.outstandingBalanceCents > 0 && !validated.lastPaymentFailureIso) {
      // Saldo pendiente pero sin fallo registrado — caso anómalo.
      // Podría ser una deuda administrativa. Tratar como gracia_activa
      // conservadoramente.
      newStatus = "gracia_activa";
    } else {
      newStatus = "normal";
    }
  }
  // Caso 2: gracia activa → evaluar si venció o se pagó.
  else if (validated.currentStatus === "gracia_activa") {
    if (validated.outstandingBalanceCents === 0) {
      newStatus = "gracia_resuelta";
    } else if (daysSinceLastFailure >= GRACE_PERIOD_DAYS) {
      if (validated.totalGracePeriodsUsed >= MAX_GRACE_PERIODS_BEFORE_EXHAUSTION) {
        newStatus = "credito_agotado";
      } else {
        newStatus = "gracia_vencida";
      }
    } else {
      // Sigue en gracia activa, dentro del plazo.
      newStatus = "gracia_activa";
    }
  }
  // Caso 3: gracia vencida → evaluar si pagó o si debe escalar.
  else if (validated.currentStatus === "gracia_vencida") {
    if (validated.outstandingBalanceCents === 0) {
      newStatus = "gracia_resuelta";
    } else if (validated.totalGracePeriodsUsed >= MAX_GRACE_PERIODS_BEFORE_EXHAUSTION) {
      newStatus = "credito_agotado";
    } else {
      // Sigue vencida.
      newStatus = "gracia_vencida";
    }
  }
  // Caso 4: gracia resuelta → ya pagó, vuelve a normal.
  else if (validated.currentStatus === "gracia_resuelta") {
    newStatus = validated.outstandingBalanceCents > 0 ? "gracia_activa" : "normal";
  }
  // Caso 5: crédito agotado → solo intervención humana puede revertir.
  else if (validated.currentStatus === "credito_agotado") {
    newStatus = "credito_agotado";
  }
  // Fallback seguro.
  else {
    newStatus = validated.outstandingBalanceCents === 0 ? "normal" : "gracia_activa";
  }

  // Calcular días restantes.
  const daysRemaining =
    newStatus === "gracia_activa"
      ? Math.max(0, Math.ceil(GRACE_PERIOD_DAYS - daysSinceLastFailure))
      : 0;

  // Portal bloqueado si hay saldo pendiente O estado no es normal/resuelta.
  const portalBlocked =
    validated.outstandingBalanceCents > 0 ||
    (newStatus !== "normal" && newStatus !== "gracia_resuelta");

  // Reservas futuras pausadas: gracia vencida o crédito agotado.
  const futureReservationsPaused =
    newStatus === "gracia_vencida" || newStatus === "credito_agotado";

  // Intervención humana requerida en crédito agotado o cuando es el 3er ciclo.
  const requiresHumanIntervention =
    newStatus === "credito_agotado" ||
    (newStatus === "gracia_vencida" && validated.totalGracePeriodsUsed >= MAX_GRACE_PERIODS_BEFORE_EXHAUSTION - 1);

  // Construir razón.
  let reason: string;
  switch (newStatus) {
    case "normal":
      reason = "Sin período de gracia activo. Saldo al día.";
      break;
    case "gracia_activa":
      reason = `Período de gracia activo: ${Math.floor(daysSinceLastFailure)} días desde el fallo de pago. ${daysRemaining} días restantes para pagar $${(validated.outstandingBalanceCents / 100).toFixed(2)}.`;
      break;
    case "gracia_vencida":
      reason = `Período de gracia VENCIDO: ${Math.floor(daysSinceLastFailure)} días sin pago (máximo ${GRACE_PERIOD_DAYS}). Saldo pendiente: $${(validated.outstandingBalanceCents / 100).toFixed(2)}. Reservas pausadas.`;
      break;
    case "gracia_resuelta":
      reason = "Período de gracia resuelto: el saldo fue liquidado.";
      break;
    case "credito_agotado":
      reason = `Crédito agotado después de ${validated.totalGracePeriodsUsed} períodos de gracia. Requiere intervención humana para restablecer.`;
      break;
  }

  // Auditoría.
  const auditEvent: GracePeriodAuditEvent = {
    event_type: "financiero.grace_period_evaluated",
    previousStatus: validated.currentStatus ?? null,
    newStatus,
    daysSinceLastFailure: Math.floor(daysSinceLastFailure),
    daysRemaining,
    outstandingBalanceCents: validated.outstandingBalanceCents,
    totalGracePeriodsUsed: validated.totalGracePeriodsUsed,
    portalBlocked,
    futureReservationsPaused,
    evaluatedAtIso: validated.referenceIso,
  };

  logEvent("financiero.grace_period_evaluated", auditEvent as unknown as Record<string, unknown>);

  return {
    status: newStatus,
    daysSinceLastFailure: Math.floor(daysSinceLastFailure),
    daysRemaining,
    portalBlocked,
    futureReservationsPaused,
    reason,
    requiresHumanIntervention,
  };
}

// ── Helpers: funciones de pre-chequeo rápido ─────────────────────────────────

/**
 * ¿Este cliente tiene el portal bloqueado por un período de gracia?
 * No genera evento de auditoría — útil para gatear acceso en middleware
 * sin disparar escrituras.
 *
 * @returns true si el portal debe bloquearse.
 */
export function isPortalBlockedByGrace(
  status: GracePeriodStatus | null,
  outstandingBalanceCents: number
): boolean {
  if (outstandingBalanceCents > 0) return true;
  if (!status) return false;
  return status !== "normal" && status !== "gracia_resuelta";
}

/**
 * ¿Las reservas futuras de este cliente están pausadas?
 *
 * @returns true si no se le deben permitir nuevas reservas.
 */
export function areFutureReservationsPaused(
  status: GracePeriodStatus | null
): boolean {
  return status === "gracia_vencida" || status === "credito_agotado";
}

/**
 * Calcula cuántos días restan del período de gracia.
 *
 * @returns Días restantes. 0 si no hay gracia activa o ya venció.
 */
export function calculateGraceRemainingDays(
  lastPaymentFailureIso: string | null,
  referenceIso: string
): number {
  if (!lastPaymentFailureIso) return 0;
  const referenceMs = new Date(referenceIso).getTime();
  const failureMs = new Date(lastPaymentFailureIso).getTime();
  const elapsed = (referenceMs - failureMs) / (1000 * 60 * 60 * 24);
  return Math.max(0, Math.ceil(GRACE_PERIOD_DAYS - elapsed));
}

/**
 * v8.3 G.3 / C.9 — Anti-gaming cliente: puntuación de fricción.
 *
 * Mide la proporción de tickets abiertos por el cliente respecto a sus
 * servicios completados. Un cliente que abre tickets desproporcionadamente
 * (disputas, quejas, solicitudes de reembolso) respecto a los servicios
 * que efectivamente completa está generando fricción operativa — ya sea
 * intencionalmente (gaming) o por mala experiencia real.
 *
 * Regla de negocio (invariante C.9 / G.3):
 *   tickets_abiertos / servicios_completados > 25% → tres acciones:
 *     1. Bloquear reservas esporádicas (solo recurrente con contrato).
 *     2. Exigir Auditor obligatorio en cada servicio (foto cierre + QC).
 *     3. Modal admin: "¿Ajustar tarifa +15% o terminar relación?"
 *
 * Conecta con:
 *   - anti-gaming.ts: mismo principio de muestreo determinístico y
 *     detección de manipulación, pero desde el lado del cliente.
 *   - client-scoring.ts: el ClientType y el score se cruzan con el
 *     friction ratio para decidir acciones (un cliente "elite" que
 *     dispara fricción es más sospechoso que uno nuevo).
 *
 * Funciones puras, testeables, sin acceso a base de datos. El caller
 * (middleware de reservas, ruta admin) provee los datos y aplica las
 * decisiones.
 *
 * @module client-friction-score
 */

import { z } from "zod";

// ── Constantes ───────────────────────────────────────────────────────────────

/** Ratio tickets_abiertos/servicios_completados que dispara la alarma. */
export const FRICTION_RATIO_THRESHOLD = 0.25;

/** Mínimo de servicios completados para que el ratio sea significativo.
 *  Con menos de 4 servicios, un solo ticket ya da >25% — pero es muy
 *  poco historial para declarar "fricción". */
export const MIN_SERVICIOS_PARA_FRICCION = 4;

/** Recargo porcentual sugerido cuando se activa la opción "ajustar tarifa". */
export const FRICTION_SURCHARGE_PERCENT = 0.15;

// ── Zod Schemas ──────────────────────────────────────────────────────────────

/** Input para calcular el friction score de un cliente. */
export const FrictionScoreInputSchema = z.object({
  /** Total de tickets abiertos por el cliente (disputas, quejas, reclamos). */
  ticketsAbiertos: z.number().int().min(0)
    .describe("Total de tickets abiertos históricos del cliente"),
  /** Total de servicios completados (sin disputa activa). */
  serviciosCompletados: z.number().int().min(0)
    .describe("Total de servicios completados históricos"),
  /** Tipo de cliente derivado (de client-scoring.ts). */
  clientType: z.enum(["new", "returning", "elite"])
    .describe("Tipo de cliente según deriveClientType()"),
  /** Score interno del cliente (de client-scoring.ts). */
  clientScore: z.number()
    .describe("Score interno según computeClientScore()"),
  /** Fecha del cálculo para trazabilidad de auditoría. */
  evaluatedAtIso: z.string().datetime({ offset: true })
    .describe("Timestamp ISO8601 del momento de evaluación"),
});

/** Tipo inferido del input de friction score. */
export type FrictionScoreInput = z.infer<typeof FrictionScoreInputSchema>;

/** Nivel de severidad de la fricción detectada. */
export type FrictionSeverity = "none" | "warning" | "critical";

/** Acciones administrativas que el sistema recomienda. */
export type FrictionAdminAction =
  | "none"
  | "block_sporadic_reservations"
  | "require_auditor_mandatory"
  | "surcharge_or_terminate";

/** Resultado del cálculo de fricción. */
export interface FrictionScoreResult {
  /** Ratio calculado (tickets / servicios). 0 si no hay servicios. */
  frictionRatio: number;
  /** Severidad de la fricción detectada. */
  severity: FrictionSeverity;
  /** true si el ratio supera el umbral del 25%. */
  exceedsThreshold: boolean;
  /** Acción recomendada para el sistema de reservas. */
  reservationAction: "allow_all" | "recurring_only" | "block_all";
  /** true si se debe exigir Auditor obligatorio. */
  requiresMandatoryAuditor: boolean;
  /** true si se debe mostrar el modal "ajustar tarifa o terminar". */
  showSurchargeModal: boolean;
  /** Recargo sugerido (fracción, ej. 0.15 = 15%). */
  suggestedSurcharge: number;
  /** Razón legible para el admin y el event_log. */
  reason: string;
  /** Evento de auditoría registrado (no es SystemEvent — es un log estructurado). */
  auditEvent: FrictionAuditEvent;
}

/** Registro de auditoría que se escribe en event_log cuando se evalúa fricción. */
export interface FrictionAuditEvent {
  event_type: "cliente.friction_score_evaluated";
  clientType: string;
  clientScore: number;
  ticketsAbiertos: number;
  serviciosCompletados: number;
  frictionRatio: number;
  severity: FrictionSeverity;
  reservationAction: string;
  requiresMandatoryAuditor: boolean;
  showSurchargeModal: boolean;
  evaluatedAtIso: string;
}

// ── Núcleo: cálculo de fricción ──────────────────────────────────────────────

/**
 * Calcula el friction score de un cliente: el ratio entre sus tickets
 * abiertos y sus servicios completados, y deriva las acciones
 * correspondientes según la política C.9/G.3.
 *
 * La política es deliberadamente más laxa con clientes "elite": un cliente
 * con 10+ servicios completados y score >80 tiene un track record sólido
 * que pesa contra la señal de fricción. Para ellos, el umbral efectivo
 * sube al 35% y nunca se muestra el modal de "terminar relación" — en su
 * lugar se sugiere una conversación de account management.
 *
 * @param input — Datos del cliente para evaluar fricción.
 * @returns FrictionScoreResult con la decisión y el evento de auditoría.
 */
export function evaluateClientFriction(
  input: FrictionScoreInput
): FrictionScoreResult {
  const validated = FrictionScoreInputSchema.parse(input);

  const frictionRatio =
    validated.serviciosCompletados === 0
      ? 0
      : validated.ticketsAbiertos / validated.serviciosCompletados;

  // Clientes elite tienen un umbral más alto (35%) por su track record.
  const effectiveThreshold =
    validated.clientType === "elite"
      ? FRICTION_RATIO_THRESHOLD + 0.10 // 35%
      : FRICTION_RATIO_THRESHOLD;

  // Sin suficientes servicios, el ratio no es significativo.
  const hasEnoughHistory =
    validated.serviciosCompletados >= MIN_SERVICIOS_PARA_FRICCION;

  const exceedsThreshold = hasEnoughHistory && frictionRatio > effectiveThreshold;

  // Determinar severidad.
  let severity: FrictionSeverity;
  if (!exceedsThreshold) {
    severity = "none";
  } else if (frictionRatio > effectiveThreshold * 2) {
    // Más del doble del umbral → crítico.
    severity = "critical";
  } else {
    severity = "warning";
  }

  // Determinar acción de reservas.
  let reservationAction: "allow_all" | "recurring_only" | "block_all";
  if (!exceedsThreshold) {
    reservationAction = "allow_all";
  } else if (severity === "critical") {
    reservationAction = "block_all";
  } else {
    reservationAction = "recurring_only";
  }

  // Auditor obligatorio si la fricción supera el umbral (cualquier severidad).
  const requiresMandatoryAuditor = exceedsThreshold;

  // Modal "ajustar tarifa o terminar": solo para clientes no-elite con
  // fricción. Clientes elite con fricción van a account management, no a
  // recargo automático ni terminación.
  const showSurchargeModal =
    exceedsThreshold && validated.clientType !== "elite";

  const suggestedSurcharge = showSurchargeModal ? FRICTION_SURCHARGE_PERCENT : 0;

  // Construir razón legible.
  let reason: string;
  if (!hasEnoughHistory && frictionRatio > FRICTION_RATIO_THRESHOLD) {
    reason = `Ratio alto (${formatPercent(frictionRatio)}), pero insuficientes servicios (${validated.serviciosCompletados} < ${MIN_SERVICIOS_PARA_FRICCION}) para declarar fricción.`;
  } else if (!exceedsThreshold) {
    reason = `Sin fricción significativa: ${validated.ticketsAbiertos} tickets / ${validated.serviciosCompletados} servicios = ${formatPercent(frictionRatio)} (umbral ${formatPercent(effectiveThreshold)}).`;
  } else if (validated.clientType === "elite") {
    reason = `Cliente elite con fricción elevada (${formatPercent(frictionRatio)}). Requiere account management, no acciones automáticas.`;
  } else {
    reason = `Fricción ${severity}: ${validated.ticketsAbiertos} tickets / ${validated.serviciosCompletados} servicios = ${formatPercent(frictionRatio)} (umbral ${formatPercent(effectiveThreshold)}).`;
  }

  const auditEvent: FrictionAuditEvent = {
    event_type: "cliente.friction_score_evaluated",
    clientType: validated.clientType,
    clientScore: validated.clientScore,
    ticketsAbiertos: validated.ticketsAbiertos,
    serviciosCompletados: validated.serviciosCompletados,
    frictionRatio,
    severity,
    reservationAction,
    requiresMandatoryAuditor,
    showSurchargeModal,
    evaluatedAtIso: validated.evaluatedAtIso,
  };

  return {
    frictionRatio,
    severity,
    exceedsThreshold,
    reservationAction,
    requiresMandatoryAuditor,
    showSurchargeModal,
    suggestedSurcharge,
    reason,
    auditEvent,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

// ── Función de pre-chequeo rápido ────────────────────────────────────────────

/**
 * Verificación rápida: ¿este cliente tiene fricción que bloquearía
 * una reserva esporádica? No genera evento de auditoría — útil para
 * previsualizar en el date picker sin disparar escrituras.
 *
 * @returns true si las reservas esporádicas están bloqueadas para este cliente.
 */
export function isSporadicBookingBlocked(
  ticketsAbiertos: number,
  serviciosCompletados: number,
  clientType: "new" | "returning" | "elite"
): boolean {
  if (serviciosCompletados < MIN_SERVICIOS_PARA_FRICCION) return false;
  const ratio = ticketsAbiertos / serviciosCompletados;
  const threshold =
    clientType === "elite"
      ? FRICTION_RATIO_THRESHOLD + 0.10
      : FRICTION_RATIO_THRESHOLD;
  return ratio > threshold;
}

/**
 * Verificación rápida: ¿este cliente requiere Auditor obligatorio?
 *
 * @returns true si cada servicio de este cliente debe pasar por Auditor.
 */
export function requiresMandatoryAuditorCheck(
  ticketsAbiertos: number,
  serviciosCompletados: number,
  clientType: "new" | "returning" | "elite"
): boolean {
  return isSporadicBookingBlocked(ticketsAbiertos, serviciosCompletados, clientType);
}

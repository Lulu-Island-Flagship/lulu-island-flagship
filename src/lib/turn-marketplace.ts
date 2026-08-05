/**
 * v8.3 F.8 — Marketplace de Turnos.
 *
 * Reemplaza el caos de WhatsApp para cobertura de turnos. Flujo:
 *
 *   1. Un empleado no puede cumplir su turno → el admin (o el propio
 *      empleado) publica el turno en el marketplace.
 *   2. Otros empleados ven turnos disponibles para cubrir en su PWA
 *      y ofrecen tomarlos.
 *   3. El admin aprueba con un toque (o rechaza).
 *   4. Al aprobarse: se reasigna el turno, se actualiza el dispatch,
 *      y se registra en coworker-rotation.ts para que computeRotationStatus
 *      y detectPairingExceptionViolations reflejen el cambio.
 *
 * Conexión con coworker-rotation.ts:
 *   - buildOfferToAssignmentPair() convierte una oferta aprobada en un
 *     AssignmentPair para que computeRotationStatus lo cuente como
 *     "trabajaron juntos".
 *   - validateNoPairingException() cruza la oferta contra
 *     PairingException[] antes de permitir la aprobación.
 *
 * Funciones puras: validan, transforman, determinan elegibilidad.
 * El caller (ruta API) hace INSERT/UPDATE en `turn_marketplace_offers`,
 * notifica a los empleados, y actualiza assignments.
 */

import type { AssignmentPair, PairingException } from "@/lib/coworker-rotation";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/** Estado de una oferta en el marketplace. */
export type MarketplaceOfferStatus =
  | "open"            // publicada, esperando voluntarios
  | "offer_submitted" // un empleado se ofreció, esperando aprobación admin
  | "approved"        // admin aprobó, turno reasignado
  | "rejected"        // admin rechazó la oferta
  | "cancelled"       // el turno ya no necesita cobertura
  | "expired";        // nadie se ofreció a tiempo

/** Datos para publicar un turno en el marketplace. */
export interface MarketplaceOfferInput {
  /** ID del empleado que originalmente tenía el turno (puede ser null si lo publica el admin). */
  originalEmployeeId: string | null;
  /** ID de la orden de servicio. */
  orderId: string;
  /** Fecha del turno (YYYY-MM-DD). */
  shiftDate: string;
  /** Hora de inicio (HH:MM). */
  startTime: string;
  /** Hora de fin (HH:MM). */
  endTime: string;
  /** Zona de la ciudad. */
  zone: string;
  /** Day rate estimado en centavos (para que el voluntario sepa cuánto gana). */
  estimatedPayCents: number;
  /** Nota opcional (motivo de la publicación, ej. "emergencia familiar"). */
  note: string | null;
}

/** Registro de una oferta en el marketplace, listo para INSERT. */
export interface MarketplaceOfferRecord {
  id?: string; // asignado por la DB
  original_employee_id: string | null;
  order_id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  zone: string;
  estimated_pay_cents: number;
  note: string | null;
  status: MarketplaceOfferStatus;
  created_at_iso: string;
  /** Fecha/hora límite para recibir ofertas (ISO). */
  expires_at_iso: string;
}

/** Un empleado ofrece cubrir un turno. */
export interface CoverOffer {
  /** ID de la oferta en el marketplace. */
  marketplaceOfferId: string;
  /** ID del empleado que se ofrece. */
  offeringEmployeeId: string;
  /** Timestamp ISO del ofrecimiento. */
  offeredAtIso: string;
}

/** Resultado de la validación de un ofrecimiento. */
export interface CoverOfferValidation {
  valid: boolean;
  errors: string[];
  /** Si hay una excepción de pairing, se incluye aquí para que el admin decida. */
  pairingException: PairingException | null;
}

/** Registro de una oferta de cobertura (ya aprobada o rechazada). */
export interface MarketplaceResolutionRecord {
  marketplace_offer_id: string;
  offering_employee_id: string;
  status: "approved" | "rejected";
  resolved_by_admin_id: string;
  resolved_at_iso: string;
}

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Horas de anticipación mínima para publicar un turno (el voluntario necesita tiempo). */
export const MIN_NOTICE_HOURS = 4;

/** Horas que una oferta permanece abierta antes de expirar. */
export const OFFER_EXPIRY_HOURS = 24;

/** Máximo de turnos que un empleado puede cubrir en una misma semana (anti-sobreexplotación). */
export const MAX_COVER_SHIFTS_PER_WEEK = 3;

// ---------------------------------------------------------------------------
// Validación de la publicación
// ---------------------------------------------------------------------------

/**
 * Valida que un turno pueda publicarse en el marketplace.
 *
 * Reglas:
 * - shiftDate debe ser una fecha futura.
 * - Debe haber al menos MIN_NOTICE_HOURS de anticipación.
 * - estimatedPayCents debe ser > 0.
 */
export function validateMarketplaceOfferInput(
  input: MarketplaceOfferInput,
  nowIso: string
): string[] {
  const errors: string[] = [];
  const now = new Date(nowIso);
  const shiftDateTime = new Date(`${input.shiftDate}T${input.startTime}:00`);

  if (isNaN(shiftDateTime.getTime())) {
    errors.push(`shiftDate/startTime inválidos: ${input.shiftDate} ${input.startTime}.`);
    return errors;
  }

  const hoursUntilShift = (shiftDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);

  if (hoursUntilShift < MIN_NOTICE_HOURS) {
    errors.push(
      `El turno comienza en ${hoursUntilShift.toFixed(1)}h. ` +
      `Se requiere al menos ${MIN_NOTICE_HOURS}h de anticipación para publicarlo en el marketplace.`
    );
  }

  if (input.estimatedPayCents <= 0) {
    errors.push("estimatedPayCents debe ser > 0.");
  }

  if (!input.orderId || input.orderId.trim().length === 0) {
    errors.push("orderId es requerido.");
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Construcción del registro
// ---------------------------------------------------------------------------

/**
 * Construye el registro MarketplaceOfferRecord listo para INSERT. Valida
 * antes de construir — lanza si hay errores.
 */
export function buildMarketplaceOfferRecord(
  input: MarketplaceOfferInput,
  nowIso: string
): MarketplaceOfferRecord {
  const errors = validateMarketplaceOfferInput(input, nowIso);
  if (errors.length > 0) {
    throw new Error(`Invalid marketplace offer: ${errors.join("; ")}`);
  }

  const now = new Date(nowIso);
  const expiresAt = new Date(now.getTime() + OFFER_EXPIRY_HOURS * 60 * 60 * 1000);

  return {
    original_employee_id: input.originalEmployeeId,
    order_id: input.orderId,
    shift_date: input.shiftDate,
    start_time: input.startTime,
    end_time: input.endTime,
    zone: input.zone,
    estimated_pay_cents: input.estimatedPayCents,
    note: input.note,
    status: "open",
    created_at_iso: nowIso,
    expires_at_iso: expiresAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Validación de cobertura
// ---------------------------------------------------------------------------

export interface CoverOfferEligibilityInput {
  /** ID del empleado que quiere cubrir. */
  offeringEmployeeId: string;
  /** ID del empleado original (null si lo publicó el admin). */
  originalEmployeeId: string | null;
  /** Turnos que el empleado YA tiene esta semana (incluyendo los ya cubiertos). */
  shiftsAlreadyThisWeek: number;
  /** Excepciones de pairing activas para este empleado. */
  pairingExceptions: PairingException[];
  /** Compañeros ya asignados a la misma orden (para verificar pairing). */
  existingTeammatesOnOrder: string[];
}

/**
 * Valida si un empleado es elegible para cubrir un turno.
 *
 * Reglas:
 * - No puede cubrir su propio turno (si él es el original).
 * - No puede exceder MAX_COVER_SHIFTS_PER_WEEK.
 * - No puede tener una excepción de pairing activa con ningún compañero
 *   ya asignado a esa orden (si la hay, se informa pero el admin puede
 *   override manual — la excepción se devuelve, no se bloquea).
 */
export function validateCoverOfferEligibility(
  input: CoverOfferEligibilityInput
): CoverOfferValidation {
  const errors: string[] = [];
  let pairingException: PairingException | null = null;

  // No puede cubrir su propio turno
  if (input.offeringEmployeeId === input.originalEmployeeId) {
    errors.push("No puedes cubrir tu propio turno.");
  }

  // Límite semanal anti-sobreexplotación
  if (input.shiftsAlreadyThisWeek >= MAX_COVER_SHIFTS_PER_WEEK) {
    errors.push(
      `Ya cubriste ${input.shiftsAlreadyThisWeek} turnos esta semana ` +
      `(máximo ${MAX_COVER_SHIFTS_PER_WEEK}).`
    );
  }

  // Verificar excepciones de pairing contra compañeros ya asignados
  for (const exception of input.pairingExceptions) {
    const teammateIds = new Set(input.existingTeammatesOnOrder);
    if (
      (exception.employeeAId === input.offeringEmployeeId && teammateIds.has(exception.employeeBId)) ||
      (exception.employeeBId === input.offeringEmployeeId && teammateIds.has(exception.employeeAId))
    ) {
      pairingException = exception;
      errors.push(
        `Excepción de pairing activa: ${exception.reason}. ` +
        `El admin puede hacer override manual si lo considera necesario.`
      );
      break;
    }
  }

  return {
    valid: errors.length === 0 || (errors.length === 1 && pairingException !== null),
    errors,
    pairingException,
  };
}

// ---------------------------------------------------------------------------
// Resolución (aprobación / rechazo)
// ---------------------------------------------------------------------------

/**
 * Construye el registro de resolución (aprobación o rechazo) listo para
 * INSERT/UPDATE en la base de datos.
 */
export function buildResolutionRecord(
  marketplaceOfferId: string,
  offeringEmployeeId: string,
  status: "approved" | "rejected",
  adminId: string,
  resolvedAtIso: string
): MarketplaceResolutionRecord {
  return {
    marketplace_offer_id: marketplaceOfferId,
    offering_employee_id: offeringEmployeeId,
    status,
    resolved_by_admin_id: adminId,
    resolved_at_iso: resolvedAtIso,
  };
}

// ---------------------------------------------------------------------------
// Conexión con coworker-rotation.ts
// ---------------------------------------------------------------------------

/**
 * Convierte una oferta de cobertura aprobada en un AssignmentPair para
 * que computeRotationStatus() de coworker-rotation.ts lo cuente como
 * "trabajaron juntos" ese día.
 *
 * @param offeringEmployeeId - El empleado que cubrió el turno.
 * @param teammateId - Un compañero ya asignado a la misma orden.
 * @param orderId - ID de la orden.
 * @param shiftDate - Fecha del turno (YYYY-MM-DD).
 */
export function buildOfferToAssignmentPair(
  offeringEmployeeId: string,
  teammateId: string,
  orderId: string,
  shiftDate: string
): AssignmentPair {
  // Garantizar orden canónica (misma convención que coworker-rotation.ts)
  const [a, b] =
    offeringEmployeeId < teammateId
      ? [offeringEmployeeId, teammateId]
      : [teammateId, offeringEmployeeId];
  return {
    employeeAId: a,
    employeeBId: b,
    orderId,
    serviceDate: shiftDate,
  };
}

/**
 * Verifica si un ofrecimiento viola alguna excepción de pairing explícita.
 * Retorna la excepción si existe, null si no hay conflicto.
 *
 * Esta función se llama ANTES de permitir que el admin apruebe —
 * si retorna una excepción, el admin ve el warning y decide si hace
 * override (la excepción es informativa, no bloqueante a este nivel).
 */
export function checkPairingExceptionForOffer(
  offeringEmployeeId: string,
  existingTeammatesOnOrder: string[],
  activeExceptions: PairingException[]
): PairingException | null {
  for (const teammateId of existingTeammatesOnOrder) {
    for (const exc of activeExceptions) {
      if (
        (exc.employeeAId === offeringEmployeeId && exc.employeeBId === teammateId) ||
        (exc.employeeBId === offeringEmployeeId && exc.employeeAId === teammateId)
      ) {
        return exc;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Utilidades de presentación
// ---------------------------------------------------------------------------

/** Determina si una oferta ya expiró. */
export function isOfferExpired(expiresAtIso: string, nowIso: string): boolean {
  return new Date(nowIso) >= new Date(expiresAtIso);
}

/**
 * Formatea la información del turno para mostrar en la PWA del empleado:
 * «Viernes 18 Ago, 9:00-14:00 — Zona Richmond — $90.00 estimado»
 */
export function formatMarketplaceOfferSummary(offer: MarketplaceOfferRecord): string {
  const date = new Date(offer.shift_date + "T12:00:00");
  const dayName = date.toLocaleDateString("es-MX", { weekday: "long" });
  const monthDay = date.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
  return `${dayName} ${monthDay}, ${offer.start_time}-${offer.end_time} — Zona ${offer.zone} — $${(offer.estimated_pay_cents / 100).toFixed(2)} estimado.`;
}

/** Etiqueta legible para cada estado de la oferta. */
export const MARKETPLACE_STATUS_LABEL: Record<MarketplaceOfferStatus, string> = {
  open: "Abierto — esperando voluntarios",
  offer_submitted: "Voluntario ofrecido — esperando tu aprobación",
  approved: "Aprobado — turno reasignado",
  rejected: "Rechazado",
  cancelled: "Cancelado",
  expired: "Expirado — sin voluntarios",
};

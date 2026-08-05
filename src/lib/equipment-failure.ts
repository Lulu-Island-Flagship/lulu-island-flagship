/**
 * v8.3 F.2 — Reporte de Equipo Dañado/Fallado.
 *
 * Flujo en PWA: el empleado encuentra equipo dañado → toma foto →
 * escribe descripción → indica si puede continuar sin él. Si NO puede
 * continuar, se genera una alerta inmediata al admin con tres opciones
 * pre-definidas:
 *
 *   1. Enviar reemplazo (replacement): el admin envía equipo nuevo al
 *      empleado en campo.
 *   2. Skip de zona (skip_zone): se autoriza omitir la zona que requería
 *      ese equipo.
 *   3. Reagendar (reschedule): se reagenda el servicio completo para
 *      otra fecha.
 *
 * Funciones puras: validan el reporte, determinan la severidad, y
 * construyen el objeto de alerta. El caller (ruta API) hace el INSERT en
 * `equipment_failure_reports`, sube la foto a Storage, y dispara la
 * notificación al admin vía unified-alerts.ts.
 */

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/** Categoría de equipo que puede fallar. */
export type EquipmentCategory =
  | "aspiradora"       // vacuum
  | "hidrolavadora"    // pressure washer
  | "pulidora"         // polisher
  | "rotativa"         // rotary scrubber
  | "quimico"          // chemical dispenser / sprayer
  | "extractor"        // extractor
  | "escalera"         // ladder
  | "carro"            // cart
  | "vehiculo"         // vehicle
  | "otro";            // other

/** Severidad del fallo: determina si se puede continuar o no. */
export type FailureSeverity = "can_continue" | "cannot_continue";

/** Opciones de resolución disponibles para el admin. */
export type AdminResolutionOption = "replacement" | "skip_zone" | "reschedule";

/** Datos que el empleado reporta desde la PWA. */
export interface EquipmentFailureInput {
  /** ID del empleado que reporta (autenticado). */
  employeeId: string;
  /** ID del equipo asignado (null si es equipo genérico no inventariado). */
  equipmentId: string | null;
  /** Categoría del equipo. */
  category: EquipmentCategory;
  /** Descripción del fallo (máx 500 chars). */
  description: string;
  /** URL de la foto en Supabase Storage (el caller la sube primero). */
  photoUrl: string | null;
  /** ¿El empleado puede continuar trabajando sin este equipo? */
  canContinue: boolean;
  /** ID de la orden de servicio activa en ese momento. */
  activeOrderId: string | null;
  /** Zona de la propiedad que se ve afectada (ej. "cocina", "baño_1"). */
  affectedZone: string | null;
}

/** Registro del reporte, listo para INSERT en `equipment_failure_reports`. */
export interface EquipmentFailureRecord {
  employee_id: string;
  equipment_id: string | null;
  category: EquipmentCategory;
  description: string;
  photo_url: string | null;
  can_continue: boolean;
  active_order_id: string | null;
  affected_zone: string | null;
  reported_at_iso: string;
}

/** Alerta que se envía al admin cuando el empleado NO puede continuar. */
export interface EquipmentFailureAlert {
  reportId: string; // asignado por el caller después del INSERT
  employeeId: string;
  category: EquipmentCategory;
  description: string;
  photoUrl: string | null;
  activeOrderId: string | null;
  affectedZone: string | null;
  reportedAtIso: string;
  availableOptions: AdminResolutionOption[];
  urgency: "high";
}

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Longitud máxima de la descripción del fallo. */
export const MAX_FAILURE_DESCRIPTION_LENGTH = 500;

/** Categorías de equipo que requieren reemplazo inmediato (no skip). */
export const CRITICAL_EQUIPMENT: readonly EquipmentCategory[] = [
  "vehiculo",
  "hidrolavadora",
] as const;

/** Categorías de equipo para las que "skip_zone" es una opción viable */
export const SKIPPABLE_EQUIPMENT: readonly EquipmentCategory[] = [
  "aspiradora",
  "pulidora",
  "rotativa",
  "extractor",
  "escalera",
] as const;

// ---------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------

/**
 * Valida el input del reporte de equipo dañado. Retorna array de errores;
 * vacío = válido.
 */
export function validateEquipmentFailureInput(input: EquipmentFailureInput): string[] {
  const errors: string[] = [];

  if (!input.employeeId || input.employeeId.trim().length === 0) {
    errors.push("employeeId es requerido.");
  }

  if (!input.description || input.description.trim().length === 0) {
    errors.push("description es requerida.");
  }

  if (input.description && input.description.length > MAX_FAILURE_DESCRIPTION_LENGTH) {
    errors.push(
      `description no debe exceder ${MAX_FAILURE_DESCRIPTION_LENGTH} caracteres. ` +
        `Recibido: ${input.description.length}.`
    );
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Construcción del registro
// ---------------------------------------------------------------------------

/**
 * Construye el registro EquipmentFailureRecord listo para INSERT. Valida
 * antes de construir — lanza si hay errores.
 */
export function buildEquipmentFailureRecord(
  input: EquipmentFailureInput,
  reportedAtIso: string
): EquipmentFailureRecord {
  const errors = validateEquipmentFailureInput(input);
  if (errors.length > 0) {
    throw new Error(`Invalid equipment failure report: ${errors.join("; ")}`);
  }

  return {
    employee_id: input.employeeId,
    equipment_id: input.equipmentId,
    category: input.category,
    description: input.description.trim(),
    photo_url: input.photoUrl,
    can_continue: input.canContinue,
    active_order_id: input.activeOrderId,
    affected_zone: input.affectedZone,
    reported_at_iso: reportedAtIso,
  };
}

// ---------------------------------------------------------------------------
// Lógica de severidad y opciones del admin
// ---------------------------------------------------------------------------

/**
 * Determina las opciones de resolución disponibles para el admin según
 * la categoría del equipo dañado y si el empleado puede continuar.
 *
 * Reglas:
 * - Si el empleado PUEDE continuar → sin opciones (el admin solo revisa).
 * - Si es equipo CRÍTICO (vehículo, hidrolavadora) → solo replacement y
 *   reschedule (no se puede hacer skip de zona para equipo esencial).
 * - Si es SKIPPABLE (aspiradora, pulidora, etc.) → replacement,
 *   skip_zone, y reschedule.
 * - Químicos y otros → replacement y reschedule.
 */
export function getAvailableResolutionOptions(
  category: EquipmentCategory,
  canContinue: boolean
): AdminResolutionOption[] {
  if (canContinue) return [];

  const options: AdminResolutionOption[] = ["replacement", "reschedule"];

  if (SKIPPABLE_EQUIPMENT.includes(category)) {
    // Insert skip_zone in the middle — replacement, skip_zone, reschedule
    options.splice(1, 0, "skip_zone");
  }

  return options;
}

/**
 * Construye la alerta para el admin cuando el empleado NO puede continuar.
 * Solo debe llamarse cuando canContinue === false.
 *
 * @param reportId - ID del registro ya insertado en la base de datos.
 * @param input - El input original del empleado.
 * @param reportedAtIso - Timestamp ISO del reporte.
 */
export function buildFailureAlert(
  reportId: string,
  input: EquipmentFailureInput,
  reportedAtIso: string
): EquipmentFailureAlert {
  return {
    reportId,
    employeeId: input.employeeId,
    category: input.category,
    description: input.description,
    photoUrl: input.photoUrl,
    activeOrderId: input.activeOrderId,
    affectedZone: input.affectedZone,
    reportedAtIso,
    availableOptions: getAvailableResolutionOptions(input.category, input.canContinue),
    urgency: "high",
  };
}

// ---------------------------------------------------------------------------
// Utilidades de presentación
// ---------------------------------------------------------------------------

/** Etiqueta legible para cada categoría de equipo (EN, idioma de la PWA). */
export const EQUIPMENT_CATEGORY_LABEL: Record<EquipmentCategory, string> = {
  aspiradora: "Vacuum",
  hidrolavadora: "Pressure Washer",
  pulidora: "Polisher",
  rotativa: "Rotary Scrubber",
  quimico: "Chemical Dispenser",
  extractor: "Extractor",
  escalera: "Ladder",
  carro: "Cart",
  vehiculo: "Vehicle",
  otro: "Other Equipment",
};

/** Etiqueta legible para cada opción de resolución. */
export const RESOLUTION_OPTION_LABEL: Record<AdminResolutionOption, string> = {
  replacement: "Send Replacement",
  skip_zone: "Authorize Zone Skip",
  reschedule: "Reschedule Service",
};

/**
 * Genera un resumen legible del reporte para mostrar en la alerta del admin
 * y en el historial de la orden.
 */
export function formatFailureSummary(record: EquipmentFailureRecord): string {
  const label = EQUIPMENT_CATEGORY_LABEL[record.category];
  const status = record.can_continue ? "Can continue without it" : "Cannot continue — admin action required";
  let summary = `${label}: ${record.description}. ${status}.`;
  if (record.affected_zone) {
    summary += ` Affected zone: ${record.affected_zone}.`;
  }
  return summary;
}

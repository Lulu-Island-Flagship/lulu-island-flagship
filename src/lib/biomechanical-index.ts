/**
 * v8.3 E8 — C.15: Índice de Carga Biomecánica del Empleado.
 *
 * WorkSafeBC BC OHS Regulations Part 4 (General Conditions) y Part 7
 * (Noise, Vibration, Radiation and Temperature): el empleador debe
 * controlar la exposición acumulada a tareas de alta carga física para
 * prevenir lesiones musculoesqueléticas (MSI) y fatiga severa.
 *
 * Cada tipo de servicio tiene un Índice de Carga Biomecánica (1-5),
 * donde 1 es carga mínima (oficina pequeña, move-out vacío) y 5 es
 * carga máxima (post-construcción, deep clean con EPP pesado).
 *
 * El motor de despacho (src/lib/dispatch-team.ts) aplica un hard-block:
 * un empleado no puede acumular un índice combinado superior a
 * BIOMECHANICAL_72H_MAX_POINTS en una ventana de 72 horas, forzando
 * alternancia entre servicios pesados y livianos.
 *
 * Conecta con:
 * - src/lib/dispatch-team.ts: buildTeam() llama a
 *   isBiomechanicalHardBlockActive() antes de asignar candidatos.
 * - src/lib/wellbeing.ts: los datos de ánimo/fatiga del empleado se
 *   cruzan con la carga biomecánica para detectar riesgo compuesto.
 *
 * @module biomechanical-index
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Ventana de acumulación de carga biomecánica (horas). */
export const BIOMECHANICAL_WINDOW_HOURS = 72;

/** Puntaje máximo acumulado permitido en la ventana de 72 horas. */
export const BIOMECHANICAL_72H_MAX_POINTS = 10;

/**
 * Umbral de carga por servicio individual que dispara la regla de
 * alternancia: si el empleado ya tiene acumulación > 0 y el próximo
 * servicio es >= este umbral, se fuerza uno liviano (score <= 2) primero.
 */
export const BIOMECHANICAL_HEAVY_THRESHOLD = 3;

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

/** Catálogo de tipos de servicio con su carga biomecánica asociada. */
export const ServiceTypeBiomechanicalLoadSchema = z.enum([
  "post_construccion",       // ⚠️ 5 — polvo denso, escombros, EPP pesado, química agresiva
  "deep_clean_quimico",      // ⚠️ 4 — desinfección profunda, químicos, EPP moderado
  "move_in_out_ocupado",     // ⚠️ 3 — carga/descarga, muebles, cajas
  "regular_mantenimiento",   // ✅ 2 — limpieza estándar de mantenimiento
  "comercial_ligero",        // ✅ 2 — oficinas pequeñas, tránsito ligero
  "move_out_vacio",          // ✅ 1 — propiedad vacía, solo superficies
  "oficina_pequena",         // ✅ 1 — escritorios, basura, baño ligero
  "inspeccion_superficial",  // ✅ 1 — solo revisión visual, sin carga física
]);

/** Tipo de servicio con carga biomecánica. */
export type ServiceTypeBiomechanical = z.infer<typeof ServiceTypeBiomechanicalLoadSchema>;

/**
 * Mapa de carga biomecánica 1-5 por tipo de servicio.
 *
 * WorkSafeBC: la clasificación se basa en la combinación de factores de
 * riesgo MSI según la Regulation Part 4: fuerza, repetición, postura
 * forzada, y exposición a vibración/químicos. Los servicios con score 4-5
 * requieren pausas obligatorias entre asignaciones.
 */
export const BIOMECHANICAL_LOAD_SCORES: Record<ServiceTypeBiomechanical, number> = {
  post_construccion: 5,
  deep_clean_quimico: 4,
  move_in_out_ocupado: 3,
  regular_mantenimiento: 2,
  comercial_ligero: 2,
  move_out_vacio: 1,
  oficina_pequena: 1,
  inspeccion_superficial: 1,
};

/** Registro individual de un servicio completado con su carga biomecánica. */
export const BiomechanicalLoadRecordSchema = z.object({
  employee_id: z.string().min(1),
  service_type: ServiceTypeBiomechanicalLoadSchema,
  load_score: z.number().int().min(1).max(5),
  started_at_iso: z.string().datetime({ offset: true }),
  completed_at_iso: z.string().datetime({ offset: true }),
  order_id: z.string().min(1),
});

/** Tipo inferido de un registro de carga biomecánica. */
export type BiomechanicalLoadRecord = z.infer<typeof BiomechanicalLoadRecordSchema>;

/** Resultado de la evaluación de carga acumulada en la ventana de 72 horas. */
export const BiomechanicalAccumulationResultSchema = z.object({
  employee_id: z.string(),
  /** Puntaje total acumulado en la ventana de 72 horas. */
  total_score_72h: z.number().int().min(0),
  /** Lista de registros dentro de la ventana de 72 horas. */
  records_in_window: z.array(BiomechanicalLoadRecordSchema),
  /** true si se excedió el máximo permitido (hard-block activo). */
  hard_block_active: z.boolean(),
  /** Cuántos puntos faltan para llegar al máximo (0 si ya lo excedió). */
  remaining_budget: z.number().int().min(0),
  /** Sugerencia del próximo tipo de servicio aceptable. */
  next_allowed_max_score: z.number().int().min(1).max(5),
});

/** Tipo inferido del resultado de acumulación. */
export type BiomechanicalAccumulationResult = z.infer<typeof BiomechanicalAccumulationResultSchema>;

/** Input para verificar si un candidato puede ser asignado a un servicio. */
export const HardBlockCheckInputSchema = z.object({
  employee_id: z.string().min(1),
  service_type: ServiceTypeBiomechanicalLoadSchema,
  /** Registros de servicios completados por este empleado en el período relevante. */
  recent_records: z.array(BiomechanicalLoadRecordSchema),
  /** Timestamp de referencia para la ventana de 72h (normalmente now). */
  reference_iso: z.string().datetime({ offset: true }),
});

/** Tipo inferido del input de verificación de hard-block. */
export type HardBlockCheckInput = z.infer<typeof HardBlockCheckInputSchema>;

/** Resultado de la verificación de hard-block para un candidato. */
export const HardBlockCheckResultSchema = z.object({
  employee_id: z.string(),
  /** true si el empleado PUEDE ser asignado (no hay hard-block). */
  allowed: z.boolean(),
  /** Razón del bloqueo si allowed=false. */
  block_reason: z.string().nullable(),
  /** Puntaje que tendría el empleado si se asigna este servicio. */
  projected_score_72h: z.number().int().min(0),
  /** Si está bloqueado, el servicio más pesado que SÍ puede aceptar. */
  alternative_service_type: ServiceTypeBiomechanicalLoadSchema.nullable(),
});

/** Tipo inferido del resultado de hard-block. */
export type HardBlockCheckResult = z.infer<typeof HardBlockCheckResultSchema>;

// ---------------------------------------------------------------------------
// Funciones de carga biomecánica
// ---------------------------------------------------------------------------

/**
 * Obtiene el score de carga biomecánica para un tipo de servicio.
 *
 * @param serviceType - Tipo de servicio del catálogo.
 * @returns Score 1-5 según BIOMECHANICAL_LOAD_SCORES.
 */
export function getBiomechanicalScore(serviceType: ServiceTypeBiomechanical): number {
  return BIOMECHANICAL_LOAD_SCORES[serviceType];
}

/**
 * Determina si un tipo de servicio se considera "pesado" (score >= umbral).
 * Usado por el motor de alternancia para forzar un servicio liviano después
 * de uno pesado.
 *
 * @param serviceType - Tipo de servicio a evaluar.
 * @returns true si el score es >= BIOMECHANICAL_HEAVY_THRESHOLD (3).
 */
export function isHeavyService(serviceType: ServiceTypeBiomechanical): boolean {
  return getBiomechanicalScore(serviceType) >= BIOMECHANICAL_HEAVY_THRESHOLD;
}

/**
 * Filtra los registros de carga biomecánica que caen dentro de la ventana
 * de 72 horas desde `referenceIso` hacia atrás.
 *
 * WorkSafeBC: la ventana de 72 horas es el estándar de la industria para
 * fatiga acumulada en trabajo físico repetitivo. No es 24h (demasiado corto
 * — no captura acumulación inter-diaria) ni 7 días (demasiado laxo — permite
 * que un empleado acumule 4 servicios pesados en lunes-martes).
 *
 * @param records - Todos los registros del empleado.
 * @param referenceIso - Timestamp de referencia (normalmente now).
 * @returns Solo los registros cuya fecha de inicio cae dentro de la ventana.
 */
export function filterRecordsInWindow(
  records: BiomechanicalLoadRecord[],
  referenceIso: string
): BiomechanicalLoadRecord[] {
  const reference = new Date(referenceIso).getTime();
  const windowStart = reference - BIOMECHANICAL_WINDOW_HOURS * 60 * 60 * 1000;

  return records.filter((r) => {
    const startedAt = new Date(r.started_at_iso).getTime();
    return startedAt >= windowStart && startedAt <= reference;
  });
}

/**
 * Calcula el puntaje total acumulado de carga biomecánica en la ventana
 * de 72 horas para un empleado.
 *
 * @param recordsInWindow - Registros ya filtrados por filterRecordsInWindow().
 * @returns Puntaje total (suma de load_score de todos los registros).
 */
export function calculateAccumulatedScore(recordsInWindow: BiomechanicalLoadRecord[]): number {
  return recordsInWindow.reduce((sum, r) => sum + r.load_score, 0);
}

/**
 * Evalúa la carga biomecánica acumulada de un empleado y determina si
 * el hard-block está activo.
 *
 * Esta es la función principal que dispatch-team.ts debe llamar ANTES de
 * incluir a un candidato en buildTeam(). Si hard_block_active es true,
 * el candidato se excluye de la lista de disponibles para ese servicio.
 *
 * @param employeeId - ID del empleado.
 * @param allRecords - Todos los registros de carga del empleado.
 * @param referenceIso - Timestamp de referencia (inyectado para testeabilidad).
 * @returns Resultado completo de la evaluación de acumulación.
 */
export function evaluateBiomechanicalAccumulation(
  employeeId: string,
  allRecords: BiomechanicalLoadRecord[],
  referenceIso: string
): BiomechanicalAccumulationResult {
  const recordsInWindow = filterRecordsInWindow(allRecords, referenceIso);
  const totalScore = calculateAccumulatedScore(recordsInWindow);
  const hardBlockActive = totalScore >= BIOMECHANICAL_72H_MAX_POINTS;
  const remainingBudget = hardBlockActive ? 0 : BIOMECHANICAL_72H_MAX_POINTS - totalScore;

  // Si el hard-block está activo, solo se permiten servicios de score 1.
  // Si no, el máximo permitido es el presupuesto restante (clamp 1-5).
  const nextAllowedMaxScore = hardBlockActive
    ? 1
    : Math.max(1, Math.min(5, remainingBudget));

  return BiomechanicalAccumulationResultSchema.parse({
    employee_id: employeeId,
    total_score_72h: totalScore,
    records_in_window: recordsInWindow,
    hard_block_active: hardBlockActive,
    remaining_budget: remainingBudget,
    next_allowed_max_score: nextAllowedMaxScore,
  });
}

/**
 * Verifica si un empleado específico puede ser asignado a un servicio,
 * considerando su carga biomecánica acumulada en las últimas 72 horas.
 *
 * WorkSafeBC: este hard-block es obligatorio — no es una sugerencia ni
 * una advertencia. El motor de despacho DEBE excluir al candidato si
 * `allowed` es false. La salud del empleado está por encima de la
 * eficiencia operativa del despacho.
 *
 * @param input - Datos del empleado, tipo de servicio y registros recientes.
 * @returns Resultado de la verificación con allowed, razón de bloqueo, y alternativa.
 */
export function isBiomechanicalHardBlockActive(
  input: HardBlockCheckInput
): HardBlockCheckResult {
  const validated = HardBlockCheckInputSchema.parse(input);
  const accumulation = evaluateBiomechanicalAccumulation(
    validated.employee_id,
    validated.recent_records,
    validated.reference_iso
  );

  const serviceScore = getBiomechanicalScore(validated.service_type);

  // Caso 1: hard-block total — el empleado ya excedió el máximo.
  if (accumulation.hard_block_active) {
    return HardBlockCheckResultSchema.parse({
      employee_id: validated.employee_id,
      allowed: false,
      block_reason:
        `Hard-block biomecánico activo: acumuló ${accumulation.total_score_72h} puntos ` +
        `en 72h (máx ${BIOMECHANICAL_72H_MAX_POINTS}). Solo se permiten servicios ` +
        `de score 1 (oficina_pequena, move_out_vacio, inspeccion_superficial).`,
      projected_score_72h: accumulation.total_score_72h + serviceScore,
      alternative_service_type: "inspeccion_superficial",
    });
  }

  // Caso 2: el servicio propuesto excede el presupuesto restante.
  const projectedScore = accumulation.total_score_72h + serviceScore;
  if (projectedScore > BIOMECHANICAL_72H_MAX_POINTS) {
    // Buscar el tipo de servicio más pesado que SÍ cabe en el presupuesto.
    const alternative = findHeaviestAllowedService(accumulation.remaining_budget);

    return HardBlockCheckResultSchema.parse({
      employee_id: validated.employee_id,
      allowed: false,
      block_reason:
        `El servicio "${validated.service_type}" (score ${serviceScore}) excede el ` +
        `presupuesto restante de ${accumulation.remaining_budget} puntos. ` +
        `Acumulación actual: ${accumulation.total_score_72h}/${BIOMECHANICAL_72H_MAX_POINTS}.`,
      projected_score_72h: projectedScore,
      alternative_service_type: alternative,
    });
  }

  // Caso 3: permitido — cabe en el presupuesto.
  return HardBlockCheckResultSchema.parse({
    employee_id: validated.employee_id,
    allowed: true,
    block_reason: null,
    projected_score_72h: projectedScore,
    alternative_service_type: null,
  });
}

/**
 * Encuentra el tipo de servicio más pesado que cabe en el presupuesto
 * restante de carga biomecánica.
 *
 * @param remainingBudget - Puntos restantes en la ventana de 72h.
 * @returns El tipo de servicio más pesado permitido.
 */
function findHeaviestAllowedService(
  remainingBudget: number
): ServiceTypeBiomechanical {
  const candidates = Object.entries(BIOMECHANICAL_LOAD_SCORES)
    .filter(([, score]) => score <= remainingBudget)
    .sort(([, a], [, b]) => b - a); // de más pesado a más liviano

  if (candidates.length === 0) {
    return "inspeccion_superficial"; // fallback: el más liviano
  }

  return candidates[0][0] as ServiceTypeBiomechanical;
}

// ---------------------------------------------------------------------------
// Regla de alternancia pesado/liviano
// ---------------------------------------------------------------------------

/**
 * Resultado de la verificación de alternancia: después de un servicio
 * pesado, fuerza uno liviano antes de permitir otro pesado.
 */
export const AlternanciaResultSchema = z.object({
  /** true si el empleado debe alternar a un servicio liviano ahora. */
  must_alternate: z.boolean(),
  /** Razón de la exigencia de alternancia. */
  reason: z.string().nullable(),
  /** Último servicio completado (el que dispara la regla). */
  last_service_type: ServiceTypeBiomechanicalLoadSchema.nullable(),
  /** Score del último servicio. */
  last_service_score: z.number().int().min(0).max(5),
});

/** Tipo inferido del resultado de alternancia. */
export type AlternanciaResult = z.infer<typeof AlternanciaResultSchema>;

/**
 * Verifica si el empleado debe alternar a un servicio liviano.
 *
 * WorkSafeBC: después de un servicio de alta carga biomecánica (score >= 3),
 * el siguiente servicio asignado debe ser de baja carga (score <= 2) para
 * permitir recuperación muscular. Esta regla aplica incluso si el empleado
 * no ha excedido el máximo de 72h — es una protección adicional contra la
 * fatiga acumulada de corto plazo.
 *
 * @param lastServiceType - Tipo del último servicio completado (null si es el primero del día).
 * @returns Resultado indicando si se debe forzar alternancia.
 */
export function evaluateAlternancia(
  lastServiceType: ServiceTypeBiomechanical | null
): AlternanciaResult {
  if (!lastServiceType) {
    return AlternanciaResultSchema.parse({
      must_alternate: false,
      reason: null,
      last_service_type: null,
      last_service_score: 0,
    });
  }

  const lastScore = getBiomechanicalScore(lastServiceType);

  if (lastScore >= BIOMECHANICAL_HEAVY_THRESHOLD) {
    return AlternanciaResultSchema.parse({
      must_alternate: true,
      reason:
        `El último servicio fue "${lastServiceType}" (score ${lastScore}, pesado). ` +
        `WorkSafeBC exige alternancia: el próximo servicio debe ser liviano (score <= 2).`,
      last_service_type: lastServiceType,
      last_service_score: lastScore,
    });
  }

  return AlternanciaResultSchema.parse({
    must_alternate: false,
    reason: null,
    last_service_type: lastServiceType,
    last_service_score: lastScore,
  });
}

// ---------------------------------------------------------------------------
// Filtro de candidatos para integración con dispatch-team.ts
// ---------------------------------------------------------------------------

/**
 * Interfaz mínima que un candidato de dispatch-team.ts debe exponer para
 * que este módulo pueda evaluar su carga biomecánica.
 *
 * Se diseñó para ser compatible con DispatchCandidate de dispatch-team.ts:
 * solo necesita `id` — los registros de carga se proveen aparte.
 */
export interface BiomechanicalCandidate {
  id: string;
}

/**
 * Filtra una lista de candidatos de despacho, excluyendo a aquellos que
 * tienen hard-block biomecánico activo para el tipo de servicio dado.
 *
 * Esta función es el punto de integración directo con dispatch-team.ts:
 * buildTeam() (o su caller) debe pasar los candidatos por este filtro
 * ANTES de invocar la lógica de formación de equipo.
 *
 * WorkSafeBC: un empleado excluido por hard-block biomecánico no puede
 * ser reinsertado manualmente por el admin — la exclusión es obligatoria
 * y solo se levanta cuando la ventana de 72h rota naturalmente.
 *
 * @param candidates - Lista de candidatos disponibles para despacho.
 * @param serviceType - Tipo de servicio que se necesita cubrir.
 * @param employeeLoadRecords - Mapa de employee_id → registros de carga recientes.
 * @param referenceIso - Timestamp de referencia (normalmente now).
 * @returns Solo los candidatos que pasan el hard-block biomecánico.
 */
export function filterCandidatesByBiomechanicalLoad<T extends BiomechanicalCandidate>(
  candidates: T[],
  serviceType: ServiceTypeBiomechanical,
  employeeLoadRecords: Map<string, BiomechanicalLoadRecord[]>,
  referenceIso: string
): { allowed: T[]; blocked: Array<{ candidate: T; reason: string }> } {
  const allowed: T[] = [];
  const blocked: Array<{ candidate: T; reason: string }> = [];

  for (const candidate of candidates) {
    const records = employeeLoadRecords.get(candidate.id) ?? [];
    const check = isBiomechanicalHardBlockActive({
      employee_id: candidate.id,
      service_type: serviceType,
      recent_records: records,
      reference_iso: referenceIso,
    });

    if (check.allowed) {
      allowed.push(candidate);
    } else {
      blocked.push({
        candidate,
        reason: check.block_reason ?? "Hard-block biomecánico activo",
      });
    }
  }

  return { allowed, blocked };
}

/**
 * Construye un BiomechanicalLoadRecord a partir de los datos de un servicio
 * completado. Útil para registrar la carga después de que el servicio
 * termina, alimentando el historial para futuras evaluaciones.
 *
 * @param employeeId - ID del empleado.
 * @param serviceType - Tipo de servicio completado.
 * @param startedAtIso - Timestamp de inicio del servicio.
 * @param completedAtIso - Timestamp de finalización.
 * @param orderId - ID de la orden de servicio.
 * @returns Registro validado listo para persistir.
 */
export function createBiomechanicalRecord(
  employeeId: string,
  serviceType: ServiceTypeBiomechanical,
  startedAtIso: string,
  completedAtIso: string,
  orderId: string
): BiomechanicalLoadRecord {
  return BiomechanicalLoadRecordSchema.parse({
    employee_id: employeeId,
    service_type: serviceType,
    load_score: getBiomechanicalScore(serviceType),
    started_at_iso: startedAtIso,
    completed_at_iso: completedAtIso,
    order_id: orderId,
  });
}

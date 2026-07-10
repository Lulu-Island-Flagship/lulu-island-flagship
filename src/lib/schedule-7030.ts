/**
 * v8.3 E3 — Modelo 70/30: Horario Base / Ventana de Contingencia.
 * Cita textual del spec (v8.3, invariante de despacho/nómina):
 *   "Horario Base (70%, 5 días de antelación) + Ventana de Contingencia
 *    (30%, pagada aunque no se asigne, hasta 5:30 PM del día anterior).
 *    Cambios post-5:30 PM solo emergencias validadas. Derecho a rechazar
 *    horas extra ('jornada completa' → reasignación sin penalización de
 *    score)."
 *
 * Funciones puras — sin acceso a base de datos ni reloj real (el llamador
 * inyecta "ahora" y las fechas ya normalizadas a hora de pared de Vancouver,
 * siguiendo el mismo patrón que src/lib/workday.ts y el cron dispatch-scheduler).
 */

export const BASE_SHARE = 0.7;
export const CONTINGENCY_SHARE = 0.3;
export const BASE_ADVANCE_NOTICE_DAYS = 5;
/** Hora de corte de la Ventana de Contingencia: 5:30 PM (17:30) del día anterior. */
export const CONTINGENCY_CUTOFF_HOUR = 17;
export const CONTINGENCY_CUTOFF_MINUTE = 30;

// ------------------------------------------------------------
// 1. Clasificación Horario Base (70%) vs Ventana de Contingencia (30%)
// ------------------------------------------------------------

export interface ScheduleBlock {
  id: string;
  dayOfWeek: number; // 0-6
  durationMinutes: number;
  /** días de antelación con los que se fijó este bloque en el calendario del empleado */
  advanceNoticeDays: number;
}

export type ScheduleBlockKind = "base" | "contingency";

export interface ClassifiedBlock extends ScheduleBlock {
  kind: ScheduleBlockKind;
}

export interface ScheduleClassification {
  totalMinutes: number;
  baseMinutes: number;
  contingencyMinutes: number;
  expectedBaseMinutes: number;
  expectedContingencyMinutes: number;
  blocks: ClassifiedBlock[];
  /** ¿la proporción real de Horario Base cae dentro de la tolerancia del 70% esperado? */
  withinTolerance: boolean;
  deviationReasons: string[];
}

/**
 * Clasifica los bloques de un horario semanal: un bloque es "base" si se fijó
 * con >= 5 días de antelación (v8.3), y "contingencia" en caso contrario.
 * También compara la proporción real contra el reparto 70/30 esperado.
 *
 * @param toleranceRatio margen aceptado sobre el total (default 5%) antes de
 *   marcar `withinTolerance = false` — el reparto real rara vez cae exacto.
 */
export function classifySchedule(
  blocks: ScheduleBlock[],
  toleranceRatio = 0.05
): ScheduleClassification {
  const totalMinutes = blocks.reduce((acc, b) => acc + Math.max(0, b.durationMinutes), 0);
  const expectedBaseMinutes = Math.round(totalMinutes * BASE_SHARE);
  const expectedContingencyMinutes = totalMinutes - expectedBaseMinutes;

  const classifiedBlocks: ClassifiedBlock[] = blocks.map((b) => ({
    ...b,
    kind: b.advanceNoticeDays >= BASE_ADVANCE_NOTICE_DAYS ? "base" : "contingency",
  }));

  const baseMinutes = classifiedBlocks
    .filter((b) => b.kind === "base")
    .reduce((acc, b) => acc + Math.max(0, b.durationMinutes), 0);
  const contingencyMinutes = totalMinutes - baseMinutes;

  const deviationReasons: string[] = [];
  const tolerance = totalMinutes * toleranceRatio;
  const withinTolerance = Math.abs(baseMinutes - expectedBaseMinutes) <= tolerance;
  if (totalMinutes > 0 && !withinTolerance) {
    deviationReasons.push(
      `Horario Base real (${baseMinutes} min) se desvía del 70% esperado (${expectedBaseMinutes} min) más allá de la tolerancia de ${(toleranceRatio * 100).toFixed(0)}%`
    );
  }

  return {
    totalMinutes,
    baseMinutes,
    contingencyMinutes,
    expectedBaseMinutes,
    expectedContingencyMinutes,
    blocks: classifiedBlocks,
    withinTolerance,
    deviationReasons,
  };
}

// ------------------------------------------------------------
// 2. Validez de cambios de horario vs. corte de 5:30 PM del día anterior
// ------------------------------------------------------------

/**
 * Corte de la Ventana de Contingencia para un servicio en `serviceDateISO`
 * ("YYYY-MM-DD"): las 5:30 PM (hora Vancouver) del día ANTERIOR.
 */
export function contingencyCutoff(serviceDateISO: string): Date {
  const [y, m, d] = serviceDateISO.split("-").map(Number);
  return new Date(y, m - 1, d - 1, CONTINGENCY_CUTOFF_HOUR, CONTINGENCY_CUTOFF_MINUTE, 0, 0);
}

export interface ScheduleChangeRequest {
  /** fecha del servicio afectado por el cambio propuesto */
  serviceDateISO: string;
  /** momento de la solicitud, ya en hora de pared de Vancouver */
  requestedAt: Date;
  /** ¿el cambio fue validado como emergencia por un admin? */
  isValidatedEmergency: boolean;
}

export interface ScheduleChangeDecision {
  allowed: boolean;
  reason: string;
  cutoff: Date;
  isPastCutoff: boolean;
}

/**
 * Evalúa si un cambio de horario propuesto es válido:
 *  - Antes del corte (5:30 PM del día anterior): siempre permitido.
 *  - Después del corte: solo permitido si es una emergencia validada.
 */
export function evaluateScheduleChange(req: ScheduleChangeRequest): ScheduleChangeDecision {
  const cutoff = contingencyCutoff(req.serviceDateISO);
  const isPastCutoff = req.requestedAt.getTime() > cutoff.getTime();

  if (!isPastCutoff) {
    return {
      allowed: true,
      reason: "Dentro de la Ventana de Contingencia (antes del corte de 5:30 PM del día anterior)",
      cutoff,
      isPastCutoff,
    };
  }

  if (req.isValidatedEmergency) {
    return {
      allowed: true,
      reason: "Corte ya pasó, pero es una emergencia validada por admin (excepción explícita del v8.3)",
      cutoff,
      isPastCutoff,
    };
  }

  return {
    allowed: false,
    reason: "Corte de 5:30 PM del día anterior ya pasó y no hay emergencia validada — cambio rechazado",
    cutoff,
    isPastCutoff,
  };
}

// ------------------------------------------------------------
// 3. Pago garantizado de la Ventana de Contingencia
// ------------------------------------------------------------

/**
 * La Ventana de Contingencia (30%) se paga SIEMPRE, se asigne o no trabajo
 * en ella ("pagada aunque no se asigne"). Retorna centavos.
 */
export function calculateContingencyGuaranteedPay(
  contingencyMinutes: number,
  hourlyRateCents: number
): number {
  return Math.round((Math.max(0, contingencyMinutes) / 60) * hourlyRateCents);
}

// ------------------------------------------------------------
// 4. Derecho a rechazar horas extra sin penalización de score
// ------------------------------------------------------------

export type WorkdayStatus = "ok" | "overtime_needs_approval" | "blocked";

export interface OvertimeRejectionDecision {
  canRejectWithoutPenalty: boolean;
  requiresReassignment: boolean;
  reason: string;
}

/**
 * "Jornada completa" (workdayStatus !== "ok") da al empleado derecho a
 * rechazar el excedente sin penalización de score — la orden se reasigna
 * en su lugar, en vez de forzar la jornada extra.
 */
export function evaluateOvertimeRejection(workdayStatus: WorkdayStatus): OvertimeRejectionDecision {
  if (workdayStatus === "ok") {
    return {
      canRejectWithoutPenalty: false,
      requiresReassignment: false,
      reason: "Jornada dentro de lo estándar (8h) — no aplica derecho a rechazo",
    };
  }
  return {
    canRejectWithoutPenalty: true,
    requiresReassignment: true,
    reason:
      workdayStatus === "blocked"
        ? "Jornada completa (>10h, bloqueada) — reasignación obligatoria sin penalización de score"
        : "Jornada completa (>8h, requiere autorización) — el empleado puede rechazar sin penalización de score; reasignar",
  };
}

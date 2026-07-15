/**
 * v8.3 E11.3/E11.4 — Recuperación de desastres: lógica pura para evaluar el
 * resultado de un simulacro de restauración a partir del chequeo de
 * integridad (RPC dr_drill_integrity_check, migración 097) y compararlo
 * contra el RTO declarado (rto_targets, migración 096).
 *
 * Esta lib NO toca la base de datos — recibe el resultado ya consultado del
 * RPC y decide 'pass' | 'fail' | 'partial' con una regla explícita y
 * testeable, en vez de dejar la clasificación a criterio libre de la ruta.
 */

export interface IntegrityCheckResult {
  rowCounts: Record<string, number>;
  referentialIntegrity: Record<string, number>;
  passed: boolean;
}

export type DrillResult = "pass" | "fail" | "partial";

export interface DrillEvaluation {
  result: DrillResult;
  reasons: string[];
  /** true si duration_seconds está dentro del RTO declarado (o si no hay RTO/duración para comparar) */
  withinRto: boolean | null;
}

/**
 * Regla de clasificación:
 *  - 'fail': hay huérfanos referenciales (integridad rota) O alguna tabla
 *    crítica que debería tener datos está en 0 (restauración vacía/incompleta).
 *  - 'partial': integridad referencial OK, pero el simulacro tardó más que el
 *    RTO declarado para ese tipo de dato (la restauración "funciona" pero no
 *    cumple el SLA que el negocio prometió).
 *  - 'pass': integridad OK y dentro de RTO (o sin RTO que comparar).
 */
export function evaluateDrillResult(
  check: IntegrityCheckResult,
  options?: { durationSeconds?: number; rtoHours?: number; criticalTablesExpectedNonEmpty?: string[] }
): DrillEvaluation {
  const reasons: string[] = [];

  const orphanEntries = Object.entries(check.referentialIntegrity).filter(([, count]) => count > 0);
  for (const [key, count] of orphanEntries) {
    reasons.push(`Integridad referencial rota: ${key} = ${count}`);
  }

  const emptyCritical = (options?.criticalTablesExpectedNonEmpty ?? []).filter(
    (table) => (check.rowCounts[table] ?? 0) === 0
  );
  for (const table of emptyCritical) {
    reasons.push(`Tabla crítica vacía tras la restauración: ${table}`);
  }

  const hasFailure = orphanEntries.length > 0 || emptyCritical.length > 0 || !check.passed;

  let withinRto: boolean | null = null;
  if (options?.durationSeconds !== undefined && options?.rtoHours !== undefined) {
    const rtoSeconds = options.rtoHours * 3600;
    withinRto = options.durationSeconds <= rtoSeconds;
    if (!withinRto) {
      reasons.push(
        `Duración ${options.durationSeconds}s excede el RTO declarado de ${options.rtoHours}h (${rtoSeconds}s)`
      );
    }
  }

  if (hasFailure) {
    return { result: "fail", reasons, withinRto };
  }
  if (withinRto === false) {
    return { result: "partial", reasons, withinRto };
  }
  return { result: "pass", reasons: reasons.length ? reasons : ["Integridad OK, dentro de RTO"], withinRto };
}

/**
 * v8.3 E11.4 — cada tipo de simulacro declarado en el plan tiene un
 * intervalo obligatorio ("restauración cada 6 meses", "simulacro de
 * sucesión anual", etc.). Antes de esto, la tabla `disaster_recovery_drills`
 * (migración 095) guardaba el historial pero nada calculaba si el intervalo
 * ya se venció — el criterio de aceptación E11.4 era auditable a mano, no en
 * pantalla. Estas constantes y esta función pura cierran ese hueco: dado el
 * último simulacro de un tipo (o null si nunca se corrió), dicen si está
 * vencido.
 */
export type DrillType =
  | "restore_verification"
  | "succession_simulation"
  | "emergency_kit_check"
  | "fallback_no_admin";

export const DRILL_REQUIRED_INTERVAL_DAYS: Record<DrillType, number> = {
  restore_verification: 182, // ~6 meses
  succession_simulation: 365, // anual
  emergency_kit_check: 182, // ~6 meses (semestral)
  fallback_no_admin: 91, // ~3 meses (trimestral)
};

export interface DrillOverdueStatus {
  drillType: DrillType;
  intervalDays: number;
  lastRunAt: string | null;
  daysSinceLastRun: number | null;
  isOverdue: boolean;
}

/**
 * `lastRunAt` es la fecha del simulacro MÁS RECIENTE de ese tipo, sin
 * importar su resultado (pass/fail/partial) — lo que se audita es que se
 * haya CORRIDO en el intervalo, no que haya pasado; un simulacro fallido
 * sigue siendo evidencia de que se probó (y de que hay algo que arreglar).
 * Si nunca se corrió (`lastRunAt === null`), se considera vencido de
 * inmediato: no hay evidencia de que el proceso exista.
 */
export function computeDrillOverdueStatus(
  drillType: DrillType,
  lastRunAt: string | null,
  nowIso: string
): DrillOverdueStatus {
  const intervalDays = DRILL_REQUIRED_INTERVAL_DAYS[drillType];

  if (lastRunAt === null) {
    return { drillType, intervalDays, lastRunAt: null, daysSinceLastRun: null, isOverdue: true };
  }

  const daysSinceLastRun = (new Date(nowIso).getTime() - new Date(lastRunAt).getTime()) / (1000 * 60 * 60 * 24);

  return {
    drillType,
    intervalDays,
    lastRunAt,
    daysSinceLastRun,
    isOverdue: daysSinceLastRun >= intervalDays,
  };
}

export function computeAllDrillOverdueStatuses(
  lastRunByType: Partial<Record<DrillType, string | null>>,
  nowIso: string
): DrillOverdueStatus[] {
  const types: DrillType[] = [
    "restore_verification",
    "succession_simulation",
    "emergency_kit_check",
    "fallback_no_admin",
  ];
  return types.map((t) => computeDrillOverdueStatus(t, lastRunByType[t] ?? null, nowIso));
}

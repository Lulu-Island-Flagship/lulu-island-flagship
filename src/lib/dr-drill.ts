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

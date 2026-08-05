/**
 * v8.3 F.6 — Métricas Personales Visibles (Sin Comparación).
 *
 * El empleado ve SUS tendencias en la PWA — nunca un ranking, nunca una
 * comparación con pares, nunca un "puesto 7 de 12":
 *
 *   «Tu eficiencia: 94% esta semana (vs 91% anterior).»
 *   «Tus clientes te calificaron 4.8/5 este mes.»
 *   «Llevas 3 semanas sin disputas.»
 *
 * REGLA DURA: NUNCA score numérico individual comparativo.
 * Si el sistema solo puede expresar una métrica como posición relativa,
 * debe usar rangos amplios y anónimos:
 *
 *   ✅ «Estás en el top 20% de eficiencia.»
 *   ✅ «Tu puntualidad está en el promedio del equipo.»
 *   ❌ «Estás en el puesto 7 de 12.»
 *   ❌ «Tu score es 73/100, el promedio es 81/100.»
 *
 * Defensa en profundidad (mismo patrón que team-ranking.ts):
 *
 *   1. Capa de tipos: no existe `rank`, `position`, o `percentile`
 *      numérico exacto. Solo rangos cualitativos pre-definidos.
 *   2. Capa de runtime: `assertNoComparativeLeak` escanea el objeto de
 *      salida y lanza si detecta claves como "rank", "position",
 *      "percentile", "puesto", "lugar" — fail-closed.
 *   3. Capa de salida: EmployeePersonalMetrics solo contiene tendencias
 *      propias, promedios anónimos de referencia (que no revelan
 *      posiciones), y rangos cualitativos.
 *
 * Funciones puras: reciben datos pre-filtrados por el caller (ruta API,
 * que ya hizo WHERE employee_id = $auth) y producen el view-model.
 */

// ---------------------------------------------------------------------------
// Rangos cualitativos (lo ÚNICO que puede ver el empleado sobre su posición)
// ---------------------------------------------------------------------------

/**
 * Rangos cualitativos para expresar posición relativa sin revelar el
 * número exacto ni el ranking. Son los ÚNICOS valores que el sistema
 * puede mostrar al empleado sobre "cómo estoy versus los demás".
 */
export type QualitativeRange =
  | "top_5_percent"
  | "top_10_percent"
  | "top_20_percent"
  | "above_average"
  | "on_average"
  | "below_average";

/** Etiquetas legibles para la PWA (EN). */
export const QUALITATIVE_RANGE_LABEL: Record<QualitativeRange, string> = {
  top_5_percent: "top 5%",
  top_10_percent: "top 10%",
  top_20_percent: "top 20%",
  above_average: "por encima del promedio",
  on_average: "en el promedio del equipo",
  below_average: "por debajo del promedio",
};

// ---------------------------------------------------------------------------
// Tipos de entrada (datos pre-filtrados por el caller)
// ---------------------------------------------------------------------------

/** Métricas semanales del empleado. */
export interface EmployeeWeeklyMetric {
  weekStart: string;    // YYYY-MM-DD (lunes)
  /** Eficiencia como porcentaje 0-100 (tiempo real vs estimado). */
  efficiencyPct: number;
  /** Puntualidad como porcentaje 0-100 (llegadas a tiempo). */
  punctualityPct: number;
  /** Calificación promedio de clientes esta semana (1-5). */
  avgClientRating: number;
  /** Cantidad de disputas abiertas esta semana. */
  disputeCount: number;
  /** Cantidad de servicios completados esta semana. */
  completedServices: number;
}

/** Promedio anónimo de referencia (calculado por el caller con datos de todo el equipo). */
export interface TeamAnonymousBenchmark {
  /** Promedio de eficiencia del equipo (sin revelar quiénes). */
  avgEfficiencyPct: number;
  /** Promedio de puntualidad del equipo. */
  avgPunctualityPct: number;
  /** Promedio de calificación de clientes del equipo. */
  avgClientRating: number;
  /** Percentil 80 de eficiencia (para mapear a QualitativeRange). */
  p80EfficiencyPct: number;
  /** Percentil 90 de eficiencia. */
  p90EfficiencyPct: number;
  /** Percentil 95 de eficiencia. */
  p95EfficiencyPct: number;
}

// ---------------------------------------------------------------------------
// Tipos de salida (view-model para PWA)
// ---------------------------------------------------------------------------

/** Tendencia de una métrica: actual vs período anterior. */
export interface MetricTrend {
  /** Valor actual (ej. 94). */
  current: number;
  /** Valor del período anterior (ej. 91), null si no hay datos. */
  previous: number | null;
  /** Dirección del cambio. */
  direction: "up" | "down" | "flat";
  /** Diferencia en puntos porcentuales (ej. +3). */
  deltaPct: number | null;
}

/** Dashboard de métricas personales para UN empleado. */
export interface EmployeePersonalMetrics {
  employeeId: string;
  /** Tendencia de eficiencia. */
  efficiency: MetricTrend;
  /** Tendencia de puntualidad. */
  punctuality: MetricTrend;
  /** Calificación promedio de clientes este mes. */
  clientRating: {
    current: number;
    previous: number | null;
  };
  /** Semanas consecutivas sin disputas. */
  weeksWithoutDisputes: number;
  /** Servicios completados este mes. */
  completedServicesThisMonth: number;
  /** Rango cualitativo de eficiencia (nunca un número de posición). */
  efficiencyRange: QualitativeRange;
  /** Rango cualitativo de puntualidad. */
  punctualityRange: QualitativeRange;
  /** Rango cualitativo de calificación de clientes. */
  clientRatingRange: QualitativeRange;
}

// ---------------------------------------------------------------------------
// Defensa en profundidad: assertNoComparativeLeak
// ---------------------------------------------------------------------------

/** Claves prohibidas en cualquier objeto de salida de este módulo. */
const FORBIDDEN_COMPARATIVE_PATTERN =
  /rank|position|percentile|puesto|lugar|place|standing|comparison/i;

/**
 * Escanea recursivamente el objeto de salida en busca de claves que
 * sugieran ranking o comparación individual. Lanza si encuentra alguna —
 * fail-closed. Este es el último cortafuegos antes de que un dato
 * comparativo llegue a la PWA del empleado.
 *
 * Mismo patrón que `assertNoIndividualIdentifier` en team-ranking.ts.
 */
export function assertNoComparativeLeak(value: unknown, path = "root"): void {
  if (value === null || value === undefined) return;

  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoComparativeLeak(item, `${path}[${i}]`));
    return;
  }

  if (typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (FORBIDDEN_COMPARATIVE_PATTERN.test(key)) {
        throw new Error(
          `F.6 PRIVACY VIOLATION: key '${path}.${key}' suggests individual ranking/comparison. ` +
            `Employee personal metrics must never expose rank, position, or percentile. ` +
            `Use QualitativeRange only (top_5_percent, top_20_percent, above_average, etc.).`
        );
      }
      assertNoComparativeLeak((value as Record<string, unknown>)[key], `${path}.${key}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Cálculo de tendencias
// ---------------------------------------------------------------------------

/**
 * Calcula la tendencia de una métrica entre dos períodos.
 *
 * @param current - Valor del período actual.
 * @param previous - Valor del período anterior (null si no hay datos).
 */
export function computeTrend(current: number, previous: number | null): MetricTrend {
  const deltaPct = previous !== null ? current - previous : null;
  let direction: MetricTrend["direction"] = "flat";
  if (deltaPct !== null) {
    direction = deltaPct > 0.01 ? "up" : deltaPct < -0.01 ? "down" : "flat";
  }
  return { current, previous, direction, deltaPct };
}

// ---------------------------------------------------------------------------
// Mapeo a rangos cualitativos
// ---------------------------------------------------------------------------

/**
 * Convierte el valor de una métrica del empleado a un QualitativeRange,
 * usando los percentiles anónimos del equipo como referencia.
 *
 * Reglas:
 * - >= p95 → top_5_percent
 * - >= p90 → top_10_percent
 * - >= p80 → top_20_percent
 * - >= avg  → above_average
 * - >= avg * 0.85 → on_average (dentro del 15% por debajo del promedio)
 * - < avg * 0.85 → below_average
 *
 * NUNCA revela "estás a 3.2 puntos del promedio" — solo el rango.
 */
export function toQualitativeRange(
  employeeValue: number,
  benchmark: TeamAnonymousBenchmark,
  metric: "efficiency" | "punctuality" | "clientRating"
): QualitativeRange {
  const avg =
    metric === "efficiency"
      ? benchmark.avgEfficiencyPct
      : metric === "punctuality"
        ? benchmark.avgPunctualityPct
        : benchmark.avgClientRating;

  const p80 =
    metric === "efficiency" ? benchmark.p80EfficiencyPct : avg * 1.05; // fallback razonable
  const p90 =
    metric === "efficiency" ? benchmark.p90EfficiencyPct : avg * 1.08;
  const p95 =
    metric === "efficiency" ? benchmark.p95EfficiencyPct : avg * 1.10;

  if (employeeValue >= p95) return "top_5_percent";
  if (employeeValue >= p90) return "top_10_percent";
  if (employeeValue >= p80) return "top_20_percent";
  if (employeeValue >= avg) return "above_average";
  if (employeeValue >= avg * 0.85) return "on_average";
  return "below_average";
}

// ---------------------------------------------------------------------------
// Cálculo de semanas sin disputas
// ---------------------------------------------------------------------------

/**
 * Cuenta cuántas semanas consecutivas (hacia atrás desde la más reciente)
 * el empleado lleva sin disputas.
 *
 * @param weeklyMetrics - Métricas semanales del empleado, ordenadas por
 *   weekStart descendente (la más reciente primero).
 */
export function computeConsecutiveWeeksWithoutDisputes(
  weeklyMetrics: EmployeeWeeklyMetric[]
): number {
  let count = 0;
  for (const week of weeklyMetrics) {
    if (week.disputeCount === 0) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Construcción del dashboard de métricas personales
// ---------------------------------------------------------------------------

export interface BuildPersonalMetricsInput {
  employeeId: string;
  /** Métricas de la semana actual. */
  currentWeek: EmployeeWeeklyMetric | null;
  /** Métricas de la semana anterior. */
  previousWeek: EmployeeWeeklyMetric | null;
  /** Métricas de las últimas N semanas (para contar disputas). */
  recentWeeks: EmployeeWeeklyMetric[];
  /** Benchmark anónimo del equipo (misma semana). */
  teamBenchmark: TeamAnonymousBenchmark;
  /** Total de servicios completados este mes. */
  completedServicesThisMonth: number;
}

/**
 * Construye el dashboard de métricas personales para UN empleado.
 *
 * El caller (ruta API) DEBE:
 * 1. Filtrar todos los datos por employee_id autenticado.
 * 2. Calcular el benchmark anónimo del equipo (promedios y percentiles)
 *    SIN incluir identificadores individuales.
 * 3. Pasar los datos ya filtrados a esta función.
 *
 * Esta función aplica defensa en profundidad con assertNoComparativeLeak
 * sobre el resultado antes de retornarlo.
 */
export function buildPersonalMetrics(input: BuildPersonalMetricsInput): EmployeePersonalMetrics {
  const efficiency = computeTrend(
    input.currentWeek?.efficiencyPct ?? 0,
    input.previousWeek?.efficiencyPct ?? null
  );

  const punctuality = computeTrend(
    input.currentWeek?.punctualityPct ?? 0,
    input.previousWeek?.punctualityPct ?? null
  );

  const clientRating = {
    current: input.currentWeek?.avgClientRating ?? 0,
    previous: input.previousWeek?.avgClientRating ?? null,
  };

  const weeksWithoutDisputes = computeConsecutiveWeeksWithoutDisputes(input.recentWeeks);

  const efficiencyRange = toQualitativeRange(
    efficiency.current,
    input.teamBenchmark,
    "efficiency"
  );

  const punctualityRange = toQualitativeRange(
    punctuality.current,
    input.teamBenchmark,
    "punctuality"
  );

  const clientRatingRange = toQualitativeRange(
    clientRating.current,
    input.teamBenchmark,
    "clientRating"
  );

  const result: EmployeePersonalMetrics = {
    employeeId: input.employeeId,
    efficiency,
    punctuality,
    clientRating,
    weeksWithoutDisputes,
    completedServicesThisMonth: input.completedServicesThisMonth,
    efficiencyRange,
    punctualityRange,
    clientRatingRange,
  };

  // Último cortafuegos: si por alguna razón el objeto contiene una clave
  // de ranking, lanza aquí antes de que llegue a la PWA.
  assertNoComparativeLeak(result);

  return result;
}

// ---------------------------------------------------------------------------
// Formateo para PWA
// ---------------------------------------------------------------------------

/**
 * Formatea una tendencia para mostrar en PWA:
 * «Tu eficiencia: 94% esta semana (vs 91% anterior).»
 */
export function formatMetricTrend(
  label: string,
  trend: MetricTrend,
  unit: string = "%"
): string {
  const base = `Tu ${label}: ${trend.current.toFixed(0)}${unit} esta semana`;
  if (trend.previous !== null && trend.direction !== "flat") {
    const arrow = trend.direction === "up" ? "↑" : "↓";
    return `${base} (vs ${trend.previous.toFixed(0)}${unit} anterior ${arrow}).`;
  }
  if (trend.previous !== null) {
    return `${base} (igual que la semana anterior).`;
  }
  return `${base}.`;
}

/**
 * Formatea las semanas sin disputas:
 * «Llevas 3 semanas sin disputas.»
 */
export function formatWeeksWithoutDisputes(count: number): string {
  if (count === 0) return "Tuviste una disputa esta semana.";
  if (count === 1) return "Llevas 1 semana sin disputas.";
  return `Llevas ${count} semanas sin disputas.`;
}

/**
 * Formatea la calificación de clientes:
 * «Tus clientes te calificaron 4.8/5 este mes.»
 */
export function formatClientRating(rating: number): string {
  if (rating === 0) return "Aún no tienes calificaciones de clientes este mes.";
  return `Tus clientes te calificaron ${rating.toFixed(1)}/5 este mes.`;
}

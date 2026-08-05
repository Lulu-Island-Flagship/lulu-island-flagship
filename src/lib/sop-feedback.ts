/**
 * v8.3 C.5 + D.5 — QC → SOP Feedback Loop.
 *
 * Cierra el hueco entre Control de Calidad (scoring.ts, E5) y Mejora de
 * Técnicas (career-path.ts, hhe-adjustment.ts, E8). Dos señales:
 *
 *   1. Anomalía SOP (event.sop.anomalia_detectada):
 *      Cuando una zona específica falla >15% en equipos DISTINTOS, el
 *      problema no es el personal sino la técnica documentada. El módulo
 *      SOP lo intercepta y levanta bandera al admin para ajustar técnica
 *      o tiempo HHE.
 *
 *   2. Cambio de nivel QC (event.qc.nivel_cambio):
 *      Cuando el nivel de scoring de un equipo baja (Élite→Estándar,
 *      Estándar→Observación, etc.), dispara un plan correctivo automático
 *      vía career-path.ts (reentrenamiento, revisión de certificación).
 *
 * Funciones puras: reciben observaciones ya leídas de la base de datos
 * y devuelven eventos listos para escribir en event_log. Nunca tocan la
 * base de datos directamente.
 *
 * Interconexiones:
 *   scoring.ts ──(zone scores)──→ sop-feedback.ts
 *       ├── event.sop.anomalia_detectada → hhe-adjustment.ts (ajuste HHE)
 *       └── event.qc.nivel_cambio → career-path.ts (plan correctivo)
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Umbral de falla por zona (%): si una zona falla más que esto entre equipos distintos, es anomalía SOP. */
export const SOP_ANOMALY_FAILURE_THRESHOLD = 0.15; // 15%, spec C.5

/** Mínimo de equipos distintos que deben haber fallado la misma zona para que sea anomalía SOP. */
export const SOP_ANOMALY_MIN_DISTINCT_TEAMS = 2;

/** Ventana de observación por defecto en días. */
export const SOP_DEFAULT_WINDOW_DAYS = 30;

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

/** Niveles de scoring de equipo, del spec E5. */
export type TeamScoreLevel = "elite" | "estandar" | "observacion" | "suspendido";

export const TEAM_SCORE_LEVEL_ORDER: TeamScoreLevel[] = [
  "elite",
  "estandar",
  "observacion",
  "suspendido",
];

/** Una observación de QC para una zona específica, en un servicio concreto. */
export interface ZoneScoreRecord {
  /** Etiqueta de la zona: "Baño", "Cocina", "Encimeras", "Suelos", "Ventanas", etc. */
  zoneLabel: string;
  /** Etiqueta del equipo que ejecutó el servicio. */
  teamLabel: string;
  /** YYYY-MM-DD del servicio. */
  date: string;
  /** Puntaje obtenido en esta zona (0-100). */
  score: number;
}

/** Registro del nivel de scoring de un equipo en un período. */
export interface TeamScoreSnapshot {
  teamLabel: string;
  /** YYYY-MM-DD del cierre del período de evaluación. */
  date: string;
  level: TeamScoreLevel;
  /** Promedio numérico del score en el período. */
  averageScore: number;
}

// ---------------------------------------------------------------------------
// Event payloads (Zod-validated for event_log)
// ---------------------------------------------------------------------------

export const SopAnomalyPayloadSchema = z.object({
  event: z.literal("event.sop.anomalia_detectada"),
  zone_label: z.string().min(1),
  failure_rate: z.number().min(0).max(1),
  distinct_teams_affected: z.number().int().min(1),
  affected_teams: z.array(z.string().min(1)),
  observation_days: z.number().int().min(1),
  window_start: z.string(), // YYYY-MM-DD
  window_end: z.string(), // YYYY-MM-DD
  message: z.string(),
  requires_admin_review: z.literal(true),
});

export type SopAnomalyPayload = z.infer<typeof SopAnomalyPayloadSchema>;

export const NivelCambioPayloadSchema = z.object({
  event: z.literal("event.qc.nivel_cambio"),
  team_label: z.string().min(1),
  previous_level: z.enum(["elite", "estandar", "observacion", "suspendido"]),
  new_level: z.enum(["elite", "estandar", "observacion", "suspendido"]),
  previous_average_score: z.number().min(0).max(100),
  new_average_score: z.number().min(0).max(100),
  date: z.string(), // YYYY-MM-DD
  message: z.string(),
  triggers_corrective_plan: z.literal(true),
});

export type NivelCambioPayload = z.infer<typeof NivelCambioPayloadSchema>;

/** Unión discriminada de eventos que este módulo puede emitir. */
export type SopFeedbackEvent =
  | { type: "sop_anomaly"; payload: SopAnomalyPayload }
  | { type: "nivel_cambio"; payload: NivelCambioPayload };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysBetween(a: string, b: string): number {
  return (
    Math.abs(
      new Date(`${a}T00:00:00Z`).getTime() -
        new Date(`${b}T00:00:00Z`).getTime()
    ) / 86_400_000
  );
}

/** Determina si un score cuenta como "falla" (< 70, mismo umbral que el nivel "estándar" mínimo). */
function isFailingScore(score: number): boolean {
  return score < 70;
}

// ---------------------------------------------------------------------------
// SOP Anomaly detection
// ---------------------------------------------------------------------------

export interface SopAnomalyDetectionOptions {
  /** Ventana de observación en días. Default: 30. */
  windowDays?: number;
  /** Umbral de falla (fracción 0-1). Default: 0.15 (15%). */
  threshold?: number;
  /** Mínimo de equipos distintos afectados. Default: 2. */
  minDistinctTeams?: number;
}

/**
 * Detecta zonas donde la tasa de falla supera el umbral y los fallos
 * provienen de equipos distintos — lo que indica que el problema es la
 * técnica del SOP, no el personal individual.
 *
 * @returns Lista de eventos `event.sop.anomalia_detectada`, uno por zona
 *          anómala detectada.
 */
export function detectSopAnomalies(
  observations: ZoneScoreRecord[],
  asOfDate: string,
  options?: SopAnomalyDetectionOptions
): SopAnomalyPayload[] {
  const threshold = options?.threshold ?? SOP_ANOMALY_FAILURE_THRESHOLD;
  const windowDays = options?.windowDays ?? SOP_DEFAULT_WINDOW_DAYS;
  const minDistinctTeams =
    options?.minDistinctTeams ?? SOP_ANOMALY_MIN_DISTINCT_TEAMS;

  // 1. Filtrar a la ventana de observación
  const inWindow = observations.filter(
    (o) => daysBetween(o.date, asOfDate) <= windowDays
  );
  if (inWindow.length === 0) return [];

  // 2. Agrupar por zona
  const byZone = new Map<string, ZoneScoreRecord[]>();
  for (const o of inWindow) {
    const list = byZone.get(o.zoneLabel);
    if (list) list.push(o);
    else byZone.set(o.zoneLabel, [o]);
  }

  const anomalies: SopAnomalyPayload[] = [];

  for (const [zoneLabel, zoneObs] of byZone.entries()) {
    if (zoneObs.length < 2) continue; // necesita al menos 2 observaciones

    const failingObs = zoneObs.filter((o: ZoneScoreRecord) => isFailingScore(o.score));
    const failureRate = failingObs.length / zoneObs.length;

    if (failureRate < threshold) continue;

    // ¿Provienen de equipos distintos?
    const distinctTeams = new Set(failingObs.map((o: ZoneScoreRecord) => o.teamLabel));
    if (distinctTeams.size < minDistinctTeams) continue;

    const dates = zoneObs.map((o: ZoneScoreRecord) => o.date).sort();
    const observationDays = daysBetween(dates[0], asOfDate);

    const payload: SopAnomalyPayload = {
      event: "event.sop.anomalia_detectada",
      zone_label: zoneLabel,
      failure_rate: Math.round(failureRate * 1000) / 1000,
      distinct_teams_affected: distinctTeams.size,
      affected_teams: Array.from(distinctTeams as Set<string>).sort(),
      observation_days: Math.ceil(observationDays),
      window_start: dates[0],
      window_end: asOfDate,
      message: `Zona "${zoneLabel}" falla en ${Math.round(failureRate * 100)}% de servicios por ${distinctTeams.size} equipos distintos. Posible falla en técnica SOP — revisar procedimiento y/o ajustar HHE.`,
      requires_admin_review: true,
    };

    // Validar contra el schema Zod antes de devolver
    anomalies.push(SopAnomalyPayloadSchema.parse(payload));
  }

  return anomalies.sort((a, b) => a.zone_label.localeCompare(b.zone_label));
}

// ---------------------------------------------------------------------------
// Nivel de equipo → cambio detectado
// ---------------------------------------------------------------------------

/**
 * Compara dos snapshots consecutivos del scoring de un equipo y detecta si
 * el nivel bajó (Élite→Estándar, Estándar→Observación, etc.). Solo detecta
 * BAJADAS — las subidas no disparan plan correctivo.
 *
 * @returns Evento `event.qc.nivel_cambio` si hubo bajada, o `null` si no.
 */
export function detectNivelCambio(
  previous: TeamScoreSnapshot,
  current: TeamScoreSnapshot
): NivelCambioPayload | null {
  if (previous.teamLabel !== current.teamLabel) {
    throw new Error(
      `detectNivelCambio: teamLabel mismatch (${previous.teamLabel} vs ${current.teamLabel})`
    );
  }

  const prevIdx = TEAM_SCORE_LEVEL_ORDER.indexOf(previous.level);
  const currIdx = TEAM_SCORE_LEVEL_ORDER.indexOf(current.level);

  // Los niveles están ordenados de mejor a peor: elite=0, suspendido=3.
  // Un índice mayor = bajada.
  if (currIdx <= prevIdx) return null; // no bajó (mismo nivel o subió)

  const payload: NivelCambioPayload = {
    event: "event.qc.nivel_cambio",
    team_label: current.teamLabel,
    previous_level: previous.level,
    new_level: current.level,
    previous_average_score: previous.averageScore,
    new_average_score: current.averageScore,
    date: current.date,
    message: `Equipo "${current.teamLabel}" bajó de "${previous.level}" a "${current.level}" (score: ${previous.averageScore} → ${current.averageScore}). Se requiere plan correctivo automático.`,
    triggers_corrective_plan: true,
  };

  return NivelCambioPayloadSchema.parse(payload);
}

/**
 * Detecta cambios de nivel entre todos los equipos comparando dos ventanas
 * de evaluación consecutivas.
 *
 * @param previousWindow Snapshots de la ventana anterior (ej. mes pasado).
 * @param currentWindow  Snapshots de la ventana actual (ej. este mes).
 * @returns Lista de eventos `event.qc.nivel_cambio` para cada equipo que bajó.
 */
export function detectAllNivelCambios(
  previousWindow: TeamScoreSnapshot[],
  currentWindow: TeamScoreSnapshot[]
): NivelCambioPayload[] {
  const prevMap = new Map(
    previousWindow.map((s) => [s.teamLabel, s] as const)
  );
  const events: NivelCambioPayload[] = [];

  for (const current of currentWindow) {
    const previous = prevMap.get(current.teamLabel);
    if (!previous) continue; // equipo nuevo, sin historial — no es bajada

    const event = detectNivelCambio(previous, current);
    if (event) events.push(event);
  }

  return events.sort((a, b) => a.team_label.localeCompare(b.team_label));
}

// ---------------------------------------------------------------------------
// Combined detection (convenience)
// ---------------------------------------------------------------------------

export interface SopFeedbackReport {
  sopAnomalies: SopAnomalyPayload[];
  nivelCambios: NivelCambioPayload[];
}

/**
 * Ejecuta ambas detecciones y devuelve un reporte unificado listo para que
 * el caller escriba a event_log y/o unified_alerts.
 */
export function generateSopFeedbackReport(
  zoneObservations: ZoneScoreRecord[],
  previousTeamSnapshots: TeamScoreSnapshot[],
  currentTeamSnapshots: TeamScoreSnapshot[],
  asOfDate: string,
  options?: SopAnomalyDetectionOptions
): SopFeedbackReport {
  return {
    sopAnomalies: detectSopAnomalies(zoneObservations, asOfDate, options),
    nivelCambios: detectAllNivelCambios(
      previousTeamSnapshots,
      currentTeamSnapshots
    ),
  };
}

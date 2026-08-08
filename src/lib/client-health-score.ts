/**
 * v8.3 G.3 / C.9 — Customer Health Score interno (solo admin).
 *
 * Calcula un puntaje compuesto de salud del cliente que combina
 * múltiples dimensiones: frecuencia de servicio, gasto mensual, score
 * interno, señales de fuga, fricción, y engagement. El resultado es
 * un HealthScore de 0-100 con timeline de 6 meses y una lista de
 * acciones sugeridas para el admin.
 *
 * Las acciones sugeridas son frases en lenguaje natural que el Command
 * Center muestra como notificaciones, por ejemplo:
 *   - "Bajó de 2/mes a 1/mes. ¿Ofrecer descuento de fidelidad?"
 *   - "Última comunicación: 45 días. ¿Enviar check-in?"
 *   - "LTV proyectado ($4,200) vs real ($2,800): brecha de -33%."
 *
 * Conecta con:
 *   - churn-detection.ts: detectChurnSignal(), ChurnSignalInput.
 *   - client-scoring.ts: computeClientScore(), deriveClientType().
 *   - client-segmentation.ts: computeClientSegment(), mapSegmentToChurnPattern().
 *
 * Funciones puras, testeables. Los datos mensuales y de comunicación
 * los provee el caller (route handler admin) desde la base de datos.
 *
 * @module client-health-score
 */

import { z } from "zod";

// ── Constantes ───────────────────────────────────────────────────────────────

/** Meses hacia atrás para la timeline de salud. */
export const HEALTH_TIMELINE_MONTHS = 6;

/** Días sin comunicación que disparan la sugerencia de check-in. */
export const CHECK_IN_DAYS_THRESHOLD = 30;

/** Días sin servicio que sugieren reactivación (cliente recurrente). */
export const REACTIVATION_DAYS_RECURRING = 45;

/** Días sin servicio que sugieren reactivación (cliente esporádico). */
export const REACTIVATION_DAYS_SPORADIC = 60;

/** LTV: vida útil proyectada del cliente en meses. */
export const LTV_PROJECTED_LIFETIME_MONTHS = 36;

// ── Zod Schemas ──────────────────────────────────────────────────────────────

/** Un snapshot mensual de actividad del cliente. */
export const MonthlyClientSnapshotSchema = z.object({
  /** Año-Mes (YYYY-MM). */
  yearMonth: z.string().regex(/^\d{4}-\d{2}$/)
    .describe("Año-Mes del snapshot (YYYY-MM)"),
  /** Servicios completados en el mes. */
  servicesCompleted: z.number().int().min(0),
  /** Gasto total en el mes (centavos). */
  totalSpendCents: z.number().int().min(0),
  /** Tickets abiertos en el mes (disputas, quejas). */
  ticketsOpened: z.number().int().min(0),
  /** Score interno promedio en el mes (de client-scoring.ts). */
  avgScore: z.number().min(0).max(100),
  /** Segmento en este mes (de client-segmentation.ts). */
  segment: z.enum(["vip", "regular", "sporadic", "at_risk", "new"]),
});

/** Tipo inferido de snapshot mensual. */
export type MonthlyClientSnapshot = z.infer<typeof MonthlyClientSnapshotSchema>;

/** Señales detectadas en el cliente que requieren atención del admin. */
export type HealthSignalType =
  | "frequency_decline"       // Bajó la frecuencia de servicios
  | "spend_decline"           // Bajó el gasto mensual
  | "score_decline"           // Bajó el score interno
  | "churn_risk"              // Señal de fuga detectada (de churn-detection.ts)
  | "no_recent_communication" // Sin comunicación reciente
  | "ltv_gap"                 // Brecha entre LTV real y proyectado
  | "segment_downgrade"       // Bajó de segmento (VIP→regular, regular→esporádico)
  | "friction_rising";        // Fricción en aumento (tickets vs servicios)

/** Una señal de salud detectada. */
export interface HealthSignal {
  type: HealthSignalType;
  severity: "info" | "warning" | "critical";
  description: string;
  /** Acción sugerida para el admin (en lenguaje natural). */
  suggestedAction: string;
}

/** Resultado completo del Health Score. */
export interface ClientHealthScore {
  /** Puntaje de salud 0-100. */
  healthScore: number;
  /** Tendencia en los últimos 6 meses: improving, stable, declining. */
  trend: "improving" | "stable" | "declining";
  /** Timeline de los últimos 6 meses. */
  timeline: MonthlyClientSnapshot[];
  /** Señales detectadas. */
  signals: HealthSignal[];
  /** LTV real calculado (centavos). */
  ltvActualCents: number;
  /** LTV proyectado (centavos). */
  ltvProjectedCents: number;
  /** Si hay brecha negativa LTV, el porcentaje. */
  ltvGapPercent: number | null;
  /** Días desde la última comunicación. */
  daysSinceLastCommunication: number | null;
  /** Días desde el último servicio completado. */
  daysSinceLastService: number;
  /** Segmento actual (de client-segmentation.ts). */
  currentSegment: string;
  /** Frecuencia de servicios: promedio mensual de los últimos 6 meses. */
  avgServicesPerMonth: number;
  /** Gasto mensual promedio de los últimos 6 meses (centavos). */
  avgMonthlySpendCents: number;
  /** Fecha de generación del reporte. */
  generatedAtIso: string;
  /** Evento de auditoría para registro externo (el caller decide si loguear). */
  auditEvent: HealthScoreAuditEvent;
}

/** Registro de auditoría que el caller puede escribir en event_log. */
export interface HealthScoreAuditEvent {
  event_type: "cliente.health_score_computed";
  healthScore: number;
  trend: string;
  currentSegment: string;
  avgServicesPerMonth: number;
  avgMonthlySpendCents: number;
  ltvActualCents: number;
  ltvProjectedCents: number;
  ltvGapPercent: number | null;
  signalsCount: number;
  signalTypes: string[];
  generatedAtIso: string;
}

/** Input para calcular el Health Score. */
export const ClientHealthScoreInputSchema = z.object({
  /** Snapshots mensuales de los últimos N meses (ordenados del más antiguo al más reciente). */
  monthlySnapshots: z.array(MonthlyClientSnapshotSchema)
    .min(1, "Debe haber al menos un snapshot mensual")
    .describe("Snapshots mensuales ordenados cronológicamente"),
  /** Días desde la última comunicación con el cliente (email, SMS, llamada). */
  daysSinceLastCommunication: z.number().int().min(0).nullable()
    .describe("Días desde la última comunicación con el cliente"),
  /** Días desde el último servicio completado. */
  daysSinceLastService: z.number().int().min(0)
    .describe("Días desde el último servicio completado"),
  /** Gasto total histórico (centavos) — para LTV real. */
  totalHistoricalSpendCents: z.number().int().min(0)
    .describe("Gasto total histórico del cliente en centavos"),
  /** Meses desde el primer servicio (para LTV). */
  monthsSinceFirstService: z.number().min(0)
    .describe("Meses transcurridos desde el primer servicio"),
  /** Gasto promedio por servicio (centavos) — para LTV proyectado. */
  avgSpendPerServiceCents: z.number().int().min(0)
    .describe("Gasto promedio por servicio en centavos"),
  /** Señal de churn más reciente (de churn-detection.ts), si existe. */
  churnSignal: z.string().nullable()
    .describe("Señal de churn detectada (churn-detection.ts), si existe"),
  /** Score interno actual del cliente (client-scoring.ts). */
  currentScore: z.number()
    .describe("Score interno actual del cliente"),
  /** Timestamp de referencia para el cálculo. */
  referenceIso: z.string().datetime({ offset: true })
    .describe("Timestamp ISO8601 de referencia"),
});

/** Tipo inferido del input de Health Score. */
export type ClientHealthScoreInput = z.infer<typeof ClientHealthScoreInputSchema>;

// ── Núcleo: cálculo del Health Score ─────────────────────────────────────────

/**
 * Calcula el Customer Health Score combinando múltiples dimensiones en
 * un solo puntaje 0-100 más una timeline de 6 meses, señales detectadas
 * y comparativa de LTV.
 *
 * Dimensiones del puntaje (cada una contribuye 0-25 puntos):
 *   1. Frecuencia (25pts): servicios/mes relativo al mejor mes.
 *   2. Gasto (25pts): gasto mensual relativo al mejor mes.
 *   3. Score interno (25pts): score actual / 100.
 *   4. Engagement (25pts): sin señales de fuga, sin inactividad.
 *
 * @param input — Datos del cliente y snapshots históricos.
 * @returns ClientHealthScore con puntaje, timeline, señales y LTV.
 */
export function computeClientHealthScore(
  input: ClientHealthScoreInput
): ClientHealthScore {
  const validated = ClientHealthScoreInputSchema.parse(input);
  const snapshots = validated.monthlySnapshots;

  // ── Frecuencia: promedio mensual de servicios ──
  const recentSnapshots = snapshots.slice(-HEALTH_TIMELINE_MONTHS);
  const avgServicesPerMonth =
    recentSnapshots.reduce((sum, s) => sum + s.servicesCompleted, 0) /
    Math.max(1, recentSnapshots.length);

  // ── Gasto promedio mensual ──
  const avgMonthlySpendCents = Math.round(
    recentSnapshots.reduce((sum, s) => sum + s.totalSpendCents, 0) /
    Math.max(1, recentSnapshots.length)
  );

  // ── Calcular puntaje compuesto (0-100) ──
  const bestServices = Math.max(1, ...recentSnapshots.map(s => s.servicesCompleted));
  const bestSpend = Math.max(1, ...recentSnapshots.map(s => s.totalSpendCents));

  const frequencyScore = Math.min(25, (avgServicesPerMonth / Math.max(1, bestServices)) * 25);
  const spendScore = Math.min(25, (avgMonthlySpendCents / Math.max(1, bestSpend)) * 25);
  const internalScore = Math.min(25, (Math.max(0, validated.currentScore) / 100) * 25);

  // Engagement: penaliza churn signal, inactividad, falta de comunicación.
  let engagementScore = 25;
  if (validated.churnSignal) engagementScore -= 10;
  if (validated.daysSinceLastService > REACTIVATION_DAYS_RECURRING) engagementScore -= 8;
  else if (validated.daysSinceLastService > CHECK_IN_DAYS_THRESHOLD) engagementScore -= 4;
  if (
    validated.daysSinceLastCommunication !== null &&
    validated.daysSinceLastCommunication > CHECK_IN_DAYS_THRESHOLD
  ) {
    engagementScore -= 3;
  }
  engagementScore = Math.max(0, engagementScore);

  const healthScore = Math.round(frequencyScore + spendScore + internalScore + engagementScore);

  // ── Tendencia ──
  let trend: "improving" | "stable" | "declining";
  if (recentSnapshots.length >= 3) {
    const firstHalf = recentSnapshots.slice(0, Math.floor(recentSnapshots.length / 2));
    const secondHalf = recentSnapshots.slice(Math.floor(recentSnapshots.length / 2));
    const firstAvg = firstHalf.reduce((s, sn) => s + sn.avgScore, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((s, sn) => s + sn.avgScore, 0) / secondHalf.length;
    if (secondAvg > firstAvg + 5) trend = "improving";
    else if (secondAvg < firstAvg - 5) trend = "declining";
    else trend = "stable";
  } else {
    trend = "stable";
  }

  // ── LTV real vs proyectado ──
  const ltvActualCents = validated.totalHistoricalSpendCents;
  const ltvProjectedCents =
    validated.avgSpendPerServiceCents *
    Math.max(1, Math.round(avgServicesPerMonth)) *
    LTV_PROJECTED_LIFETIME_MONTHS;
  const ltvGapPercent =
    ltvProjectedCents > 0
      ? Math.round(((ltvActualCents - ltvProjectedCents) / ltvProjectedCents) * 100)
      : null;

  // ── Detectar señales ──
  const signals = detectHealthSignals(validated, recentSnapshots, ltvGapPercent);

  // ── Segmento actual ──
  const currentSegment = recentSnapshots.length > 0
    ? recentSnapshots[recentSnapshots.length - 1].segment
    : "new";

  const round1 = Math.round(avgServicesPerMonth * 10) / 10;

  const auditEvent: HealthScoreAuditEvent = {
    event_type: "cliente.health_score_computed",
    healthScore,
    trend,
    currentSegment,
    avgServicesPerMonth: round1,
    avgMonthlySpendCents,
    ltvActualCents,
    ltvProjectedCents,
    ltvGapPercent,
    signalsCount: signals.length,
    signalTypes: signals.map(s => s.type),
    generatedAtIso: validated.referenceIso,
  };

  return {
    healthScore,
    trend,
    timeline: recentSnapshots,
    signals,
    ltvActualCents,
    ltvProjectedCents,
    ltvGapPercent,
    daysSinceLastCommunication: validated.daysSinceLastCommunication,
    daysSinceLastService: validated.daysSinceLastService,
    currentSegment,
    avgServicesPerMonth: round1,
    avgMonthlySpendCents,
    generatedAtIso: validated.referenceIso,
    auditEvent,
  };
}

// ── Detección de señales ────────────────────────────────────────────────────

function detectHealthSignals(
  input: ClientHealthScoreInput,
  recentSnapshots: MonthlyClientSnapshot[],
  ltvGapPercent: number | null
): HealthSignal[] {
  const signals: HealthSignal[] = [];

  if (recentSnapshots.length < 2) return signals;

  const latest = recentSnapshots[recentSnapshots.length - 1];
  const previous = recentSnapshots[recentSnapshots.length - 2];

  // 1. Bajó la frecuencia
  if (latest.servicesCompleted < previous.servicesCompleted) {
    signals.push({
      type: "frequency_decline",
      severity: latest.servicesCompleted === 0 ? "critical" : "warning",
      description: `Bajó de ${previous.servicesCompleted}/mes a ${latest.servicesCompleted}/mes.`,
      suggestedAction:
        latest.servicesCompleted === 0
          ? "Cliente sin servicios este mes. ¿Enviar oferta de reactivación?"
          : `Frecuencia bajó de ${previous.servicesCompleted} a ${latest.servicesCompleted} servicios/mes. ¿Ofrecer descuento de fidelidad?`,
    });
  }

  // 2. Bajó el gasto
  if (latest.totalSpendCents < previous.totalSpendCents * 0.7) {
    signals.push({
      type: "spend_decline",
      severity: "warning",
      description: `Gasto bajó de $${(previous.totalSpendCents / 100).toFixed(0)} a $${(latest.totalSpendCents / 100).toFixed(0)}.`,
      suggestedAction: "Gasto mensual en declive. ¿Revisar si cambió el scope de servicio?",
    });
  }

  // 3. Bajó el score
  if (latest.avgScore < previous.avgScore - 10) {
    signals.push({
      type: "score_decline",
      severity: latest.avgScore < 40 ? "critical" : "warning",
      description: `Score interno bajó de ${previous.avgScore} a ${latest.avgScore}.`,
      suggestedAction: "Score en declive. ¿Hubo una disputa no resuelta? Revisar historial de tickets.",
    });
  }

  // 4. Señal de churn
  if (input.churnSignal) {
    signals.push({
      type: "churn_risk",
      severity: "critical",
      description: `Señal de fuga detectada: ${input.churnSignal}.`,
      suggestedAction: "Intervención personal requerida. Ver churn-detection para acción específica.",
    });
  }

  // 5. Sin comunicación reciente
  if (
    input.daysSinceLastCommunication !== null &&
    input.daysSinceLastCommunication > CHECK_IN_DAYS_THRESHOLD
  ) {
    signals.push({
      type: "no_recent_communication",
      severity: input.daysSinceLastCommunication > 60 ? "warning" : "info",
      description: `Última comunicación: ${input.daysSinceLastCommunication} días.`,
      suggestedAction: `Sin comunicación hace ${input.daysSinceLastCommunication} días. ¿Enviar check-in?`,
    });
  }

  // 6. Brecha LTV
  if (ltvGapPercent !== null && ltvGapPercent < -20) {
    signals.push({
      type: "ltv_gap",
      severity: ltvGapPercent < -40 ? "critical" : "warning",
      description: `LTV real ($${(input.totalHistoricalSpendCents / 100).toFixed(0)}) ${ltvGapPercent}% bajo el proyectado.`,
      suggestedAction: `Brecha de LTV del ${ltvGapPercent}%. ¿Ajustar estrategia de retención?`,
    });
  }

  // 7. Downgrade de segmento
  if (recentSnapshots.length >= 3) {
    const olderSegment = recentSnapshots[0].segment;
    const newerSegment = latest.segment;
    const segmentRank: Record<string, number> = { vip: 4, regular: 3, sporadic: 2, at_risk: 1, new: 0 };
    if (segmentRank[newerSegment] < segmentRank[olderSegment]) {
      signals.push({
        type: "segment_downgrade",
        severity: newerSegment === "at_risk" ? "critical" : "warning",
        description: `Segmento bajó de "${olderSegment}" a "${newerSegment}".`,
        suggestedAction: `Cliente degradó de ${olderSegment} a ${newerSegment}. ¿Reactivar con beneficio exclusivo?`,
      });
    }
  }

  // 8. Fricción en aumento
  const frictionRatio = latest.servicesCompleted > 0
    ? latest.ticketsOpened / latest.servicesCompleted
    : 0;
  if (frictionRatio > 0.25) {
    signals.push({
      type: "friction_rising",
      severity: frictionRatio > 0.5 ? "critical" : "warning",
      description: `Fricción: ${latest.ticketsOpened} tickets / ${latest.servicesCompleted} servicios = ${Math.round(frictionRatio * 100)}%.`,
      suggestedAction: "Alta fricción detectada. ¿Aplicar recargo +15% o revisar account management?",
    });
  }

  return signals;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Calcula el LTV proyectado simple basado en frecuencia mensual, gasto
 * promedio por servicio y vida útil estimada.
 *
 * @returns LTV proyectado en centavos.
 */
export function projectSimpleLTV(
  avgServicesPerMonth: number,
  avgSpendPerServiceCents: number,
  lifetimeMonths: number = LTV_PROJECTED_LIFETIME_MONTHS
): number {
  return Math.round(avgServicesPerMonth * avgSpendPerServiceCents * lifetimeMonths);
}

/**
 * Determina si un cliente necesita atención inmediata del admin
 * basado en su Health Score.
 *
 * @returns "none", "review", o "urgent".
 */
export function getHealthScoreAttentionLevel(healthScore: number): "none" | "review" | "urgent" {
  if (healthScore < 30) return "urgent";
  if (healthScore < 55) return "review";
  return "none";
}

/**
 * Genera un resumen ejecutivo de una línea para el Command Center.
 *
 * @returns String listo para mostrar en el widget de salud del cliente.
 */
export function summarizeHealthScore(score: ClientHealthScore): string {
  const parts: string[] = [];
  parts.push(`Health: ${score.healthScore}/100 (${score.trend})`);
  if (score.signals.length > 0) {
    parts.push(`${score.signals.length} señal${score.signals.length !== 1 ? "es" : ""}`);
  }
  const attention = getHealthScoreAttentionLevel(score.healthScore);
  if (attention !== "none") parts.push(`— ${attention === "urgent" ? "⚠️ Urgente" : "Revisar"}`);
  return parts.join(" ");
}

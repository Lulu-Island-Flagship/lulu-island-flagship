/**
 * v8.3 E10 (C.13, H.2) — Recuperación de cotizaciones abandonadas.
 *
 * Secuencia multi-canal post-abandono:
 *   T+1h  → Email recordatorio suave.
 *   T+24h → SMS: "Su cotización $285 sigue vigente."
 *   T+72h → Email con testimonio zonal (cliente real de la misma zona).
 *   T+7d  → Último intento, sin descuento (la cotización original expira).
 *
 * Si después de T+7d no convierte, se marca el lead como "dormido" — no se
 * elimina, pero deja de recibir follow-ups automáticos. Un admin puede
 * reactivarlo manualmente.
 *
 * Cada paso de la secuencia emite un evento de atribución para que el ROI
 * de recuperación sea medible (conecta attribution.ts). Las comunicaciones
 * se envían a través del motor de comunications.ts (renderTemplate +
 * arbitrateThrottle) para respetar el límite anti-fatiga semanal.
 */

import { type AttributionEvent } from "./attribution";
import {
  renderTemplate,
  type ProposedMessage,
} from "./communications";

// ── Estados y etapas ──────────────────────────────────────────────────────────

/** Etapa de la secuencia de recuperación. */
export type RecoveryStage =
  | "t_plus_1h"
  | "t_plus_24h"
  | "t_plus_72h"
  | "t_plus_7d";

/** Estado final del lead después de la secuencia. */
export type LeadRecoveryOutcome =
  | "recovered"
  | "dormant"
  | "in_progress";

/** Una cotización abandonada con su timeline de recuperación. */
export interface AbandonedQuote {
  quoteId: string;
  clientId: string;
  clientEmail: string;
  clientPhone: string;
  clientZone: string;
  quoteAmountCents: number;
  abandonedAt: string; // ISO
  currentStage: RecoveryStage;
  outcome: LeadRecoveryOutcome;
  stagesCompleted: RecoveryStage[];
  /** ID del testimonio zonal usado en T+72h, si existe. */
  testimonialIdUsed?: string;
  /** Fecha en que se marcó como dormido (ISO). */
  dormantAt?: string;
  /** Si se recuperó, la orderId resultante. */
  recoveredOrderId?: string;
}

// ── Timing de la secuencia ────────────────────────────────────────────────────

/** Horas entre abandono y cada etapa. */
export const RECOVERY_STAGE_DELAY_HOURS: Record<RecoveryStage, number> = {
  t_plus_1h: 1,
  t_plus_24h: 24,
  t_plus_72h: 72,
  t_plus_7d: 168, // 7 días × 24h
};

/** Canales asignados a cada etapa de la secuencia. */
export const RECOVERY_STAGE_CHANNEL: Record<RecoveryStage, "email" | "sms"> = {
  t_plus_1h: "email",
  t_plus_24h: "sms",
  t_plus_72h: "email",
  t_plus_7d: "email",
};

// ── Templates de comunicación ─────────────────────────────────────────────────

/** Templates de cuerpo de mensaje para cada etapa. */
export const RECOVERY_TEMPLATES: Record<
  RecoveryStage,
  { subject?: string; body: string }
> = {
  t_plus_1h: {
    subject: "¿Necesitas ayuda con tu cotización?",
    body: `Hola {client_name},

Notamos que empezaste una cotización para limpieza en {client_zone} pero no la completaste. ¿Podemos ayudarte con algo?

Tu cotización de \${quote_amount} incluye:
- Equipo profesional con score promedio de {team_score}
- Garantía Lulu: si algo no coincide con la foto de cierre, re-servamos gratis.

Reserva en 1 clic: {resume_link}

— El equipo de Lulu Island Flagship`,
  },
  t_plus_24h: {
    body: `Lulu Island: tu cotización de \${quote_amount} para limpieza en {client_zone} sigue vigente. ¿ Reservamos tu slot? {resume_link}`,
  },
  t_plus_72h: {
    subject: "Mira lo que dicen tus vecinos en {client_zone}",
    body: `Hola {client_name},

Tu vecino en {client_zone} dice:
"{testimonial_quote}"

Tu cotización de \${quote_amount} sigue disponible. El equipo que cubre {client_zone} tiene score {team_score}/100 y habla {team_languages}.

Reserva aquí: {resume_link}

— Lulu Island Flagship`,
  },
  t_plus_7d: {
    subject: "Última oportunidad — tu cotización expira hoy",
    body: `Hola {client_name},

Tu cotización de \${quote_amount} para {client_zone} expira hoy. No podemos mantener el precio congelado por más de 7 días.

Si aún te interesa, este es el último enlace válido: {resume_link}

— Lulu Island Flagship`,
  },
};

// ── Motor de secuencia ────────────────────────────────────────────────────────

/**
 * Determina cuál es la siguiente etapa de la secuencia, dado un quote
 * abandonado en `abandonedAt` y el momento actual `nowIso`. Si la etapa
 * calculada ya fue completada, devuelve la siguiente no completada.
 *
 * Devuelve null si ya se completaron todas las etapas o si el lead ya
 * fue recuperado/marcado como dormido.
 */
export function determineNextRecoveryStage(
  quote: AbandonedQuote,
  nowIso: string,
): RecoveryStage | null {
  if (quote.outcome !== "in_progress") return null;

  const abandonedTime = new Date(quote.abandonedAt).getTime();
  const nowTime = new Date(nowIso).getTime();
  const hoursSinceAbandon = (nowTime - abandonedTime) / (1000 * 60 * 60);

  const stagesInOrder: RecoveryStage[] = [
    "t_plus_1h",
    "t_plus_24h",
    "t_plus_72h",
    "t_plus_7d",
  ];

  for (const stage of stagesInOrder) {
    if (quote.stagesCompleted.includes(stage)) continue;
    if (hoursSinceAbandon >= RECOVERY_STAGE_DELAY_HOURS[stage]) {
      return stage;
    }
  }

  return null;
}

// ── Construcción de mensajes ──────────────────────────────────────────────────

/** Variables requeridas para renderizar un mensaje de recuperación. */
export interface RecoveryMessageVars {
  client_name: string;
  client_zone: string;
  quote_amount: string;
  resume_link: string;
  team_score?: string;
  team_languages?: string;
  testimonial_quote?: string;
}

/**
 * Construye el ProposedMessage de communications.ts para una etapa de
 * recuperación. El caller luego lo pasa a arbitrateThrottle() para
 * decidir si se envía o se pospone (límite anti-fatiga semanal).
 *
 * @param quote — la cotización abandonada.
 * @param stage — etapa de la secuencia a disparar.
 * @param vars — variables de personalización.
 * @param correlationId — ID que conecta este mensaje con el quote (para atribución).
 */
export function buildRecoveryMessage(
  quote: AbandonedQuote,
  stage: RecoveryStage,
  vars: RecoveryMessageVars,
  _correlationId: string,
): ProposedMessage {
  const template = RECOVERY_TEMPLATES[stage];
  const _renderedBody = renderTemplate(template.body, vars as unknown as Record<string, string | number>);

  const channel = RECOVERY_STAGE_CHANNEL[stage];
  const _isSms = channel === "sms";

  return {
    id: `recovery_${quote.quoteId}_${stage}`,
    userId: quote.clientId,
    eventKey: `abandoned_cart_recovery.${stage}`,
    category: "marketing",
    priority: "normal",
    // Peso de marketing: etapas tardías tienen más peso (más urgente = mayor peso)
    marketingWeight: stage === "t_plus_7d" ? 90 : stage === "t_plus_72h" ? 70 : stage === "t_plus_24h" ? 50 : 30,
  };
}

// ── Transiciones de estado ────────────────────────────────────────────────────

/**
 * Registra la completación de una etapa en el quote abandonado.
 * Función pura: devuelve un nuevo objeto, no muta el original.
 */
export function completeRecoveryStage(
  quote: AbandonedQuote,
  stage: RecoveryStage,
): AbandonedQuote {
  const stagesCompleted = quote.stagesCompleted.includes(stage)
    ? quote.stagesCompleted
    : [...quote.stagesCompleted, stage];

  return {
    ...quote,
    stagesCompleted,
    currentStage: stage,
  };
}

/**
 * Marca un lead como dormido después de que la secuencia completa (T+7d)
 * no logró conversión. El lead no se elimina; un admin puede reactivarlo
 * manualmente para una campaña futura.
 */
export function markLeadAsDormant(quote: AbandonedQuote, nowIso: string): AbandonedQuote {
  return {
    ...quote,
    outcome: "dormant",
    dormantAt: nowIso,
  };
}

/**
 * Marca un lead como recuperado — el cliente concretó la orden.
 */
export function markLeadAsRecovered(
  quote: AbandonedQuote,
  orderId: string,
  _nowIso: string,
): AbandonedQuote {
  return {
    ...quote,
    outcome: "recovered",
    recoveredOrderId: orderId,
  };
}

// ── Atribución de recuperación ────────────────────────────────────────────────

/**
 * Construye eventos de atribución para cada etapa de la secuencia.
 * Permite medir cuál etapa fue la que realmente convirtió al lead.
 */
export function buildRecoveryAttributionEvents(
  quote: AbandonedQuote,
  stage: RecoveryStage,
  nowIso: string,
): AttributionEvent[] {
  const channel = RECOVERY_STAGE_CHANNEL[stage];
  return [
    {
      channel: `abandoned_recovery_${channel}`,
      touch: "last",
      occurredAt: nowIso,
    },
  ];
}

// ── ROI Tracking de recuperación ──────────────────────────────────────────────

/** Datos agregados de la secuencia de recuperación para medición de ROI. */
export interface RecoveryFunnelMetrics {
  /** Cotizaciones abandonadas en el período. */
  totalAbandoned: number;
  /** Leads que entraron a la secuencia de recuperación. */
  enteredRecovery: number;
  /** Leads recuperados (se convirtieron en orden). */
  recovered: number;
  /** Leads marcados como dormidos. */
  dormant: number;
  /** Leads aún en progreso (no han completado la secuencia). */
  inProgress: number;
  /** Ingreso total generado por leads recuperados (centavos). */
  recoveredRevenueCents: number;
  /** Costo operativo de la secuencia (SMS, emails, procesamiento). */
  recoveryCostCents: number;
}

/**
 * Calcula las métricas de ROI de la secuencia de recuperación.
 *
 * Tasa de recuperación = recuperados / entraron.
 * ROI = (ingreso recuperado - costo) / costo.
 */
export function calculateRecoveryRoi(metrics: RecoveryFunnelMetrics): {
  recoveryRatePercent: number;
  roiPercent: number;
  averageRecoveryValueCents: number;
  dormantRatePercent: number;
} {
  const recoveryRatePercent =
    metrics.enteredRecovery > 0
      ? Math.round((metrics.recovered / metrics.enteredRecovery) * 1000) / 10
      : 0;

  const dormantRatePercent =
    metrics.enteredRecovery > 0
      ? Math.round((metrics.dormant / metrics.enteredRecovery) * 1000) / 10
      : 0;

  const averageRecoveryValueCents =
    metrics.recovered > 0
      ? Math.round(metrics.recoveredRevenueCents / metrics.recovered)
      : 0;

  const roiPercent =
    metrics.recoveryCostCents > 0
      ? Math.round(
          ((metrics.recoveredRevenueCents - metrics.recoveryCostCents) /
            metrics.recoveryCostCents) *
            100
        )
      : 0;

  return {
    recoveryRatePercent,
    roiPercent,
    averageRecoveryValueCents,
    dormantRatePercent,
  };
}

/**
 * Determina si la secuencia de recuperación es rentable.
 * Umbral: ROI > 0% y tasa de recuperación > 5%.
 */
export function isRecoverySequenceHealthy(metrics: RecoveryFunnelMetrics): {
  healthy: boolean;
  reasons: string[];
} {
  const roi = calculateRecoveryRoi(metrics);
  const reasons: string[] = [];

  if (roi.roiPercent <= 0) {
    reasons.push(`ROI de recuperación es ${roi.roiPercent}% (debe ser > 0%).`);
  }
  if (roi.recoveryRatePercent <= 5) {
    reasons.push(`Tasa de recuperación es ${roi.recoveryRatePercent}% (debe ser > 5%).`);
  }
  if (metrics.totalAbandoned === 0) {
    reasons.push("No hay cotizaciones abandonadas en el período — sin datos para evaluar.");
  }

  return {
    healthy: reasons.length === 0,
    reasons,
  };
}

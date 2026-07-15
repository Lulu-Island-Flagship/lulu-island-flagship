/**
 * v8.3 E6.5 — Centro de preferencias + CASL. Regla del plan: "re-engagement
 * (5 emails sin abrir → último intento → fuera)".
 *
 * Función pura: recibe el historial reciente de `communication_log` para
 * eventos de categoría 'marketing' enviados por email (ordenados del más
 * reciente al más antiguo) y decide si corresponde dar de baja
 * automáticamente. Nunca toca la base de datos — el caller (cron) decide
 * qué hacer con el resultado.
 */

export const RE_ENGAGEMENT_UNOPENED_THRESHOLD = 5;

export type MarketingLogStatus = "queued" | "postponed" | "sent" | "delivered" | "read" | "failed";

export interface MarketingLogEntry {
  status: MarketingLogStatus;
  channel: string;
  sentAt: string | null;
}

export interface ReEngagementEvaluation {
  shouldAutoUnsubscribe: boolean;
  consecutiveUnopenedCount: number;
  reason: string;
}

/**
 * "Sin abrir" = status nunca llegó a 'read'. 'failed'/'queued'/'postponed'
 * tampoco cuentan como "abierto" pero SÍ deben excluirse del conteo (no son
 * evidencia de desinterés del cliente, son fallas de entrega del sistema) --
 * solo 'sent'/'delivered' sin avanzar a 'read' cuenta como "entregado y
 * ninguna señal de apertura".
 *
 * `recentMarketingEmailLogs` debe venir YA filtrado por: user_id, category
 * = 'marketing', channel = 'email', order by created_at DESC, y solo el
 * evento MÁS RECIENTE por hilo de campaña si aplica -- esta función no
 * deduplica, solo cuenta consecutivos desde el más reciente hacia atrás.
 */
export function evaluateReEngagement(recentMarketingEmailLogs: MarketingLogEntry[]): ReEngagementEvaluation {
  let consecutiveUnopened = 0;

  for (const entry of recentMarketingEmailLogs) {
    if (entry.status === "read") {
      break; // una apertura reciente rompe la racha -- el cliente sigue interesado
    }
    if (entry.status === "sent" || entry.status === "delivered") {
      consecutiveUnopened += 1;
      continue;
    }
    // 'queued'/'postponed'/'failed': no es señal del cliente, no cuenta ni rompe la racha.
  }

  const shouldAutoUnsubscribe = consecutiveUnopened >= RE_ENGAGEMENT_UNOPENED_THRESHOLD;

  return {
    shouldAutoUnsubscribe,
    consecutiveUnopenedCount: consecutiveUnopened,
    reason: shouldAutoUnsubscribe
      ? `${consecutiveUnopened} emails de marketing consecutivos sin apertura (umbral: ${RE_ENGAGEMENT_UNOPENED_THRESHOLD}) -- baja automática, no penaliza, respeta CASL`
      : `${consecutiveUnopened} sin abrir (umbral: ${RE_ENGAGEMENT_UNOPENED_THRESHOLD}) -- aún dentro del rango normal`,
  };
}

/** Construye el link de unsubscribe de un toque para incrustar en plantillas de email de marketing (v8.3 E6.5). */
export function buildUnsubscribeLink(unsubscribeToken: string, baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/api/communications/unsubscribe?token=${unsubscribeToken}`;
}

/**
 * v8.3 E0.9 — Observabilidad: Sentry + logging estructurado.
 *
 * DISEÑO HONESTO: no hay cuenta de Sentry contratada todavía (sin DSN, sin
 * SDK instalado). En vez de instalar `@sentry/nextjs` en falso o simular una
 * integración que no existe, este módulo separa las dos mitades del
 * requisito:
 *
 *   1. Logging estructurado: SÍ funciona hoy, sin ninguna cuenta externa —
 *      `logEvent`/`captureError` siempre emiten JSON estructurado a
 *      consola (nivel, timestamp, módulo, contexto), que es lo que
 *      cualquier plataforma de logs (Vercel, Datadog, etc.) puede indexar
 *      sin configuración adicional.
 *   2. Forwarding a Sentry: reservado para cuando exista DSN real. Mismo
 *      patrón `not_configured` que sms.ts / weather-provider.ts — nunca
 *      intenta una llamada de red a un servicio no contratado.
 *
 * TODO(dueño/infra): al contratar Sentry, `npm install @sentry/nextjs`,
 * agregar `instrumentation.ts` con `Sentry.init({ dsn: process.env.SENTRY_DSN })`,
 * y reemplazar el bloque marcado abajo por `Sentry.captureException(error, { extra: context })`.
 * `captureError`/`logEvent` son la interfaz estable que el resto del sistema
 * debe seguir llamando — solo cambia la implementación interna.
 */

export type ObservabilityForwardStatus = "logged_locally" | "forwarded_to_sentry" | "not_configured";

export interface CaptureErrorResult {
  status: ObservabilityForwardStatus;
  loggedAt: string;
}

function isSentryConfigured(): boolean {
  return Boolean(process.env.SENTRY_DSN);
}

function structuredLog(level: "info" | "warn" | "error", event: string, data?: Record<string, unknown>) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...(data ?? {}),
  };
  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

/**
 * Registra un evento informativo estructurado. Siempre funciona (no
 * requiere Sentry) — es la mitad del requisito E0.9 que no depende de
 * ningún proveedor externo.
 */
export function logEvent(event: string, data?: Record<string, unknown>): void {
  structuredLog("info", event, data);
}

/**
 * Captura un error. Siempre lo deja en el log estructurado (funciona hoy);
 * además, si algún día hay DSN configurado, este es el único punto a tocar
 * para reenviarlo a Sentry en vez de solo loguearlo localmente.
 */
export function captureError(error: unknown, context?: Record<string, unknown>): CaptureErrorResult {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  const loggedAt = new Date().toISOString();

  structuredLog("error", "captured_error", { message, stack, ...(context ?? {}) });

  if (!isSentryConfigured()) {
    return { status: "not_configured", loggedAt };
  }

  // TODO(dueño/infra): reemplazar por Sentry.captureException(error, { extra: context })
  // una vez exista @sentry/nextjs instalado y SENTRY_DSN configurado. Hasta
  // entonces, no se inventa una llamada de red a un servicio no contratado
  // -- se deja registrado como "logged_locally" (DSN presente pero SDK aún
  // no instalado sería un estado transitorio de configuración incompleta).
  return { status: "logged_locally", loggedAt };
}

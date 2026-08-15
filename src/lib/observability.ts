/**
 * v8.3 E0.9 — Observabilidad: Sentry + logging estructurado.
 *
 * v8.3 M-3 (auditoría implacable 2026-07-20b): este módulo sigue separando
 * las dos mitades del requisito:
 *
 *   1. Logging estructurado: funciona siempre, sin ninguna cuenta externa —
 *      `logEvent`/`captureError` siempre emiten JSON estructurado a
 *      consola (nivel, timestamp, módulo, contexto), que es lo que
 *      cualquier plataforma de logs (Vercel, Datadog, etc.) puede indexar
 *      sin configuración adicional.
 *   2. Forwarding a Sentry: SOLO ocurre si `isSentryConfigured()` es true
 *      (SENTRY_DSN seteado) -- mismo patrón `not_configured` que sms.ts /
 *      weather-provider.ts cuando no lo está.
 *
 * NOTA DE ENTORNO (dueño/infra): `npm install @sentry/nextjs` no pudo
 * completarse en el sandbox donde se escribió el fix original (mismo
 * problema de filesystem que se documenta en instrumentation.ts). Ya se
 * instaló en un entorno normal (2026-07-21) y quedó verificado -- ver nota
 * de import más abajo sobre por qué el paquete correcto para ESTA función
 * es `@sentry/node`, no `@sentry/nextjs`.
 *
 * `captureError`/`logEvent` son la interfaz estable que el resto del
 * sistema debe seguir llamando — solo cambió la implementación interna.
 */

// @sentry/node provides captureException; imported dynamically
// so Sentry is only loaded when SENTRY_DSN is configured.

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

  // v8.3 M-3: DSN configurado -- reenviar también a Sentry. Import
  // dinámico (no top-level) para no acoplar el arranque de este módulo al
  // SDK cuando SENTRY_DSN no está seteado (mismo espíritu que sendSms()/
  // sendEmail() solo llamando a fetch cuando su proveedor está
  // configurado). captureException() es fire-and-forget aquí a propósito:
  // un fallo de Sentry nunca debe hacer que captureError() lance, ya que su
  // contrato ("nunca lanza") es lo que el resto del sistema depende para
  // loguear errores dentro de sus propios catch.
  //
  // v8.3 fix (verificación QA post-remediación 2026-07-20b): captureError()
  // es SINCRÓNICA por contrato (todo el código que la llama lee
  // result.status sin await -- ver tests/lib/observability.test.ts). El
  // import() de arriba es async y todavía no se sabe si va a resolver bien
  // en el momento de este `return` -- devolver "forwarded_to_sentry" aquí
  // sería afirmar un éxito que todavía no ocurrió (y que, sin el paquete
  // instalado, nunca ocurre: el .catch() de abajo sí corre, pero after el
  // return). Lo único que es verdad EN ESTE INSTANTE es que ya quedó
  // logueado localmente (línea de arriba) y que se disparó un intento de
  // reenvío en segundo plano -- por eso el valor sincrónico correcto es
  // "logged_locally", igual que sin DSN configurado. "forwarded_to_sentry"
  // queda declarado en ObservabilityForwardStatus como reservado para una
  // eventual versión async de esta función que sí pueda esperar el
  // resultado real antes de responder.
  import(/* webpackIgnore: true */ "@sentry/node")
    .then((Sentry) => {
      Sentry.captureException(error, { extra: context });
    })
    .catch((sentryErr) => {
      structuredLog("warn", "sentry_forward_failed", {
        message: sentryErr instanceof Error ? sentryErr.message : String(sentryErr),
      });
    });

  return { status: "logged_locally", loggedAt };
}

/**
 * Config de Sentry para el navegador (errores de cliente/React).
 *
 * Mismo patrón "not_configured" del resto del proyecto (instrumentation.ts,
 * observability.ts): sin NEXT_PUBLIC_SENTRY_DSN no inicializa nada (no-op
 * determinista, sin requisito nuevo para build/dev/producción sin Sentry).
 *
 * El DSN del cliente DEBE ser público (NEXT_PUBLIC_*), a diferencia del
 * SENTRY_DSN server-side que lee instrumentation.ts. El CSP `connect-src`
 * ya incluye `https://*.ingest.sentry.io` para permitir el envío.
 */
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
  });
}

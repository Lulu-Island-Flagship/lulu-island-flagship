/**
 * v8.3 M-3 (auditoría implacable 2026-07-20b) — activación runtime de
 * Sentry. Next.js App Router llama automáticamente a `register()` de este
 * archivo una vez, al arrancar cada runtime (nodejs/edge), si existe en la
 * raíz del proyecto (mismo nivel que next.config.mjs) -- no requiere
 * configuración adicional de rutas.
 *
 * Mismo filosofía "not_configured" que el resto del proyecto (sms.ts,
 * email.ts, observability.ts): sin SENTRY_DSN seteado, este archivo NO
 * inicializa nada -- Sentry.init() nunca se llama, así que no hay ningún
 * requisito nuevo para build/dev/producción sin cuenta de Sentry
 * contratada. `src/lib/observability.ts` (`captureError`) es el único otro
 * punto que necesita saber si Sentry está activo (`isSentryConfigured()`).
 *
 * NOTA DE ENTORNO (dueño/infra, IMPORTANTE): `npm install @sentry/nextjs`
 * no pudo completarse en el sandbox donde se escribió este fix -- el mount
 * de `node_modules` de ese entorno bloquea `rename`/`unlink` sobre archivos
 * ya existentes (el mismo tipo de restricción documentada para
 * `.git/index.lock`), y varias instalaciones previas fallidas dejaron
 * subcarpetas parciales de otros paquetes que ya no se pueden limpiar desde
 * ahí. Por eso el import de abajo usa un especificador dinámico en
 * variable (`await import(pkg)`) en vez de un `import` estático: así
 * `tsc`/`next build` NUNCA intentan resolver el tipo del módulo en tiempo
 * de compilación (evita `TS2307: Cannot find module`) y el build no se
 * rompe aunque el paquete todavía no esté instalado. Para activar Sentry de
 * verdad: `npm install @sentry/nextjs` en un entorno normal (sin esta
 * restricción de filesystem) y setear `SENTRY_DSN` -- ningún cambio de
 * código adicional es necesario, este archivo ya está listo.
 */

// Anotado explícitamente como `string` (no literal) para que TypeScript NO
// intente resolver el módulo en tiempo de compilación en el import
// dinámico de abajo -- ver nota de entorno arriba.
const SENTRY_PACKAGE_NAME: string = "@sentry/nextjs";

export async function register() {
  if (!process.env.SENTRY_DSN) {
    // Sin DSN, no hay cuenta de Sentry contratada -- no-op determinista,
    // igual que sendSms()/sendEmail() cuando falta su proveedor.
    return;
  }

  if (process.env.NEXT_RUNTIME !== "nodejs" && process.env.NEXT_RUNTIME !== "edge") {
    return;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Sentry: any = await import(SENTRY_PACKAGE_NAME);
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      // Tasa de muestreo conservadora por defecto -- ajustable por el
      // dueño una vez exista tráfico real y cuenta paga de Sentry.
      tracesSampleRate: 0.1,
    });
  } catch (err) {
    // SENTRY_DSN está seteado pero el paquete @sentry/nextjs no está
    // instalado todavía (ver nota de entorno arriba) -- no-op, nunca se
    // rompe el arranque de la app por un SDK de observabilidad faltante.
    console.warn(
      "[instrumentation] SENTRY_DSN configurado pero @sentry/nextjs no está instalado -- Sentry no se activó:",
      err instanceof Error ? err.message : err
    );
  }
}

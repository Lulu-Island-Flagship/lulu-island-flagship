# Changelog

Todos los cambios notables del proyecto se documentan aquí. Formato basado en
[Keep a Changelog](https://keepachangelog.com/es/1.0.0/); versionado SemVer.

## [0.1.2] — 2026-08-15 (migración MANIFEST v5.0)

### Gobernanza
- Instancia alineada al Manifiesto v5.0 (núcleo genérico) — docs/PROTOCOLO-DESARROLLO.md.
- Creado `.governance/bounded-contexts.yaml` (mapa machine-readable de contextos y riesgo, version 2).
- Creado `.governance/rules.yaml` (registro de reglas verificables con niveles de evidencia).
- Creado `.governance/waivers/` (válvula de escape con schema y expiración), `.governance/break-glass/` y `.governance/change-template.yaml`.
- Creado `docs/LEARNINGS.md` (bootstrap de sesión + incidentes enlazados).
- Nuevo comando local `npm run verify:invariants` con gates: tokens/contraste/privacidad; waivers (expiración + máx. 5 + antigüedad 30 d + aprobador 40-hex); `UNCLASSIFIED` diff-aware con cota superior de riesgo por contexto; y niveles de evidencia mínimos.
- `docs/audit-v5-instance.md` (reporte de auditoría de invariantes).
- `AGENTS.md` y `ci.yml` alineados a v5.0.

### Dinero exacto (ext-financial)
- Nuevo `src/lib/money.ts`: centavos enteros como `bigint`, conversión dólares→centavos exacta (sin multiplicación por float), `applyPercentRoundHalfUp` y tasas fiscales como racionales enteros.
- `src/lib/pricing/taxes.ts` migrado a aritmética entera exacta (GST/PST sin `Math.round(x * 0.05)`).
- `src/lib/currency.ts`, `src/lib/tax-engine.ts` y `src/lib/ar-b2b/invoice.ts` delegan en el núcleo exacto.
- `src/lib/cash-reserve.ts` ya no re-declara `GST_RATE`/`PST_RATE`: re-exporta desde `src/lib/pricing/taxes.ts` (fuente única, PROTOCOLO §5) y usa el racional exacto `3/28` con `roundHalfUp` para la reserva tax-inclusive.
- Barrido de dinero en rutas API: `vehicle-fines`, `fixed-costs-settings`, `wallet`, `business-insurance`, `retention-gifts`, `dispatch`, `orders/cancel`, `force-full-capture`, `client/wallet/apply`, `client/invoice`, `paypal-refunds`, `batch-capture`, `batch-capture-retry`, `no-show`.
- Tests de conversión/redondeo exactos en `tests/lib/money.test.ts` y de límite `.5` en `tests/lib/cash-reserve.test.ts`.
- Resuelve `@incident LEARNING-003` (precisión de centavos en `computeTaxBreakdown`).

## [0.1.1] — 2026-08-14 (auditoría MANIFEST v4.2)

### Seguridad (Security)
- **Corregido** RLS de `financial_ledger`: la política "Service role full access"
  no llevaba cláusula `TO`, por lo que abría lectura+escritura del libro mayor a
  `public` (anon/authenticated). Ahora está restringida a `service_role`
  (migración `368_fix_financial_ledger_rls_scope.sql`). — `@incident LEARNING-001`
- **Corregido** RLS de `site_content`: la política `auth_write` permitía a
  cualquier usuario autenticado escribir contenido. Restringida a `service_role`
  (migración `369_fix_site_content_write_rls.sql`). — `@incident LEARNING-002`
- **Corregido** cron `purge-orphaned-resumes` sin autenticación (eliminaba
  archivos de storage con service_role expuesto a cualquier llamador). Añadido
  `requireCronAuth`.
- **Corregido** inyección de filtro PostgREST por interpolación sin validar en
  `.or()` de `api/capacity`, `api/stripe/webhook` (×2) y `api/stripe/confirm`.
  Ahora se valida `zone` (allow-list) y `payment_intent` (`^pi_[A-Za-z0-9]+$`).
- **Corregido** rate-limit de `hiring-flow/upload-resume` que derivaba la IP de
  `x-forwarded-for` (spoofeable); ahora usa `getClientIp` (prioriza
  `x-vercel-forwarded-for`).
- **Corregido** fuga de `err.message` crudo al cliente en `api/admin/tax/t4`.
- **Corregido** CSP `connect-src`: añadido `https://*.ingest.sentry.io` para
  permitir el envío de eventos a Sentry.

### Infraestructura / CI
- **Corregido** `ci.yml`: `npm run lint || true` ya no traga errores de lint, y
  el paso `Build` ya no usa `continue-on-error: true` (ahora bloquea el merge).
- **Añadido** paso `npm audit --audit-level=critical` en CI.
- **Añadido** `.github/dependabot.yml` (npm, semanal) para actualizaciones
  automáticas de dependencias.
- **Añadido** `export const maxDuration` a los crons pesados
  (backup-*, batch-capture, qbo-sync, competitor-scrape, reconcile-payments)
  para no caer en el timeout serverless por defecto.
- **Corregido** dominio de fallback en `batch-capture-retry`: apuntaba a un
  `.com` no canónico; ahora `app.luluisland.ca`.

### Correcciones
- **Corregido** regresión de accesibilidad: `goldDark` volvió a `#93712A`
  (contraste AA 4.5:1 sobre blanco); estaba en `#A8863F` (3.42:1).
- **Corregido** 9 tests que fallaban: actualizados a los códigos de cuenta
  renumerados del catálogo (`1010`/`1100`/`2080`) y a los umbrales fiscales
  2026 (CPP YMPE $74,600, EI máximo asegurable $68,900) que el motor de reglas
  ya aplicaba pero los tests aún asertaban con valores 2024.

### Notas
- Las dependencias `next@14` y `next-intl@3` tienen advisories de seguridad que
  `npm audit` reporta como high, pero en este despliegue **no son explotables**
  (sin Server Actions, sin custom server, sin Pages Router i18n, sin rewrites).
  Se rastrean vía Dependabot; el upgrade a `next@16`/`next-intl@4`/`react@19`
  es breaking y requiere una migración dedicada.

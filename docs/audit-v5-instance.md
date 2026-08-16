# Auditoría de instancia — Manifiesto v5.0

- **Fecha:** 2026-08-07 (última actividad conocida en el repo; ver nota de método).
- **Rama / objetivo:** `feat/manifiesto-v5.0` — Migración Manifiesto v5.0.
- **Alcance:** `supabase/migrations/*.sql` y `src/` (rutas API, `src/lib/`).
- **Método:** grep heurístico estático (`grep_files`) + lectura de contexto. No se ejecutó build/test/lint. No se aplicó ningún cambio de código.
- **Nota sobre bash:** el shell estaba bloqueado en este checkout compartido ("another child is writing in this shared checkout"), por lo que se usaron las herramientas de búsqueda/lectura de archivos. La fecha se infirió de la última auditoría presente en `docs/auditoria-navegacion-2026-08-07.md`.

> **Actualización (2026-08-15, misma sesión de migración v5.0):** los hallazgos
> abiertos quedaron resueltos — las 2 políticas RLS sin `TO` se cerraron con la
> migración `371_explicit_policy_to.sql` (`vehicles` → `TO authenticated`;
> `feature_flags` → `TO public`, intención de lectura pública confirmada) y el
> `err.message` crudo de `admin/tax/submit` se eliminó de la respuesta HTTP.

> **Importante (heurística 4–6):** los hallazgos de las secciones 4, 5 y 6 son **candidatos a revisar**, no violaciones confirmadas. Solo las secciones 1, 2 y 3 (RLS sin `TO`, catch vacío, `z.any()`) se tratan como verificables por inspección estática directa. Toda conclusión de seguridad requiere revisión humana del contexto de ejecución.

---

## Resumen por regla

| Regla / check | Hallazgos | Severidad | Recomendación |
|---|---|---|---|
| **INST-AUTH-001** — RLS `USING (true)` / `WITH CHECK (true)` sin cláusula `TO` | **15 políticas** (de 20 que usan `(true)`); 13 ya remediadas en migraciones posteriores, **2 abiertas al auditar — cerradas por la migración 371 (ver nota de actualización)** | ALTA (escritura) / MEDIA (lectura) | Cerrado (371). Confirmar que las remediadas no revivieron. |
| **Catch vacío** — `catch {}` / `catch { }` | **0** (1 coincidencia es un comentario) | — | Ninguna. |
| **INST-DATA-001** — `z.any()` en `src/` | **0** | — | Ninguna. |
| **`err.message` devuelto al cliente** (heurística) | **1 caso claro** + 1 ya mitigado + 9 solo-persistidos-en-BD | MEDIA | Ver §4. |
| **Timeouts a proveedores externos** (heurística) | **0 externos sin timeout**; varios `fetch()` internos sin `AbortSignal` (candidatos) | BAJA | Ver §5. |
| **Interpolación PostgREST** (`.or(\`` / `.eq(\``) (heurística) | **4 candidatos** (`.or`), 0 de `.eq` | MEDIA | Ver §6. |

---

## 1. RLS — `USING (true)` / `WITH CHECK (true)` (INST-AUTH-001)

Criterio aplicado: política `CREATE POLICY … USING (true)` / `WITH CHECK (true)` **sin cláusula `TO`** (la cláusula `TO` se buscó en la línea de la política y en las 2 líneas contiguas). Sin `TO`, la política aplica a `PUBLIC` (todos los roles, incluidos `anon` y `authenticated`).

Conteos brutos del grep: **29 líneas** coinciden con `USING (true)` / `WITH CHECK (true)`, de las cuales **5 son comentarios** (no políticas) y **24 son líneas de política** que corresponden a **20 políticas distintas** (4 políticas declaran `USING` y `WITH CHECK` en líneas separadas).

- Con cláusula `TO` (no son violación): **5**.
- Sin cláusula `TO` (violación INST-AUTH-001): **15**.

### Políticas CON `TO` (listadas para completitud)

- **supabase/migrations/013_analytics_events_table.sql:25** — `FOR INSERT TO anon, authenticated WITH CHECK (true)` (intencional, tracking de eventos).
- **supabase/migrations/358_site_content.sql:16** — `FOR SELECT TO anon, authenticated USING (true)` (página pública).
- **supabase/migrations/358_site_content.sql:21-22** — `FOR ALL TO authenticated USING (true) WITH CHECK (true)` (vulnerable por sobre-permisividad de escritura para cualquier usuario autenticado; remediada en migración 369 `TO service_role` — ver `@incident LEARNING-002`).
- **supabase/migrations/368_fix_financial_ledger_rls_scope.sql:16-17** — `FOR ALL TO service_role USING (true) WITH CHECK (true)`.
- **supabase/migrations/369_fix_site_content_write_rls.sql:12-13** — `FOR ALL TO service_role USING (true) WITH CHECK (true)`.

### Políticas SIN `TO` (violación INST-AUTH-001) — 15 (todas remediadas)

Remediadas en migraciones posteriores (234, 333, 356, 368, 371):

- **supabase/migrations/021_modulo2_payroll.sql:78** — "System insert payroll" `FOR INSERT WITH CHECK (true)` — remediada en 234 (drop) y 333 (`is_supervisor`).
- **supabase/migrations/022_modulo2_recurring_contracts.sql:100** — "System insert contract instances" `FOR INSERT WITH CHECK (true)` — tabla eliminada en 184; 333 es no-op.
- **supabase/migrations/024_modulo2_chargeback_reserve.sql:63** — "System insert chargeback reserves" — remediada en 234 y 333.
- **supabase/migrations/025_modulo2_wallet.sql:58** — "System insert wallet transactions" — remediada en 234 y 333.
- **supabase/migrations/026_modulo3_capacity_dispatch.sql:132** — "Service role insert dispatch runs" — remediada en 234 y 333.
- **supabase/migrations/073_e2_payment_retry_escalation.sql:30** — "System manage cron guard" `FOR ALL USING (true) WITH CHECK (true)` — la más grave; remediada en 234 y 333 (drop).
- **supabase/migrations/073_e2_payment_retry_escalation.sql:62** — "System insert payment recovery notifications" — remediada en 234 y 333.
- **supabase/migrations/074_e2_cash_reserve_exposure.sql:40** — "System insert tax reserve ledger" — remediada en 234 y 333.
- **supabase/migrations/074_e2_cash_reserve_exposure.sql:164** — "System insert cash exposure alerts" — remediada en 234 y 333.
- **supabase/migrations/075_e2_contract_ipc_adjustment.sql:61** — "System insert contract IPC adjustments" — remediada en 234 (drop).
- **supabase/migrations/075_e2_contract_ipc_adjustment.sql:96** — "System insert contract IPC notices" — remediada en 234 (drop).
- **supabase/migrations/350_communication_attempts.sql:39** — "Service role can insert communication attempts" `FOR INSERT WITH CHECK (true)` — remediada en 356 (`WITH CHECK (false)`).
- **supabase/migrations/365_create_financial_ledger.sql:97-98** — "Service role full access financial ledger" `FOR ALL USING (true) WITH CHECK (true)` — remediada en 368 (`TO service_role`).
- **supabase/migrations/026_modulo3_capacity_dispatch.sql:40** — "Employees read vehicles" `FOR SELECT USING (true)` sin `TO` — remediada en migración 371 (`TO authenticated`).
- **supabase/migrations/001_modulo1_base_schema.sql:219** — "Public read feature flags" `FOR SELECT USING (true)` sin `TO` — remediada en migración 371 (`TO public`).

---

## 2. Catch vacío

Búsqueda `catch {}` y `catch\s*{\s*}` (una línea) en `src/`.

- **0 hallazgos reales.**
- Única coincidencia: **src/app/[locale]/employee/page.tsx:331** — es un comentario que documenta un `catch{}` vacío ya corregido, no un catch vacío activo.

---

## 3. `z.any()` (INST-DATA-001)

Búsqueda `z.any()` en `src/` (815 archivos).

- **0 coincidencias.** No se detectaron `z.any()` ni usos junto a `.cast(` o en schemas de nómina/contabilidad.

---

## 4. `err.message` devuelto al cliente (heurística)

Búsqueda `err.message` en `src/app/api/**`: **10 coincidencias**. Clasificación:

### Caso claro (devuelto directo al cliente)

- **src/app/api/admin/tax/submit/route.ts:378** — en el `catch`, `const message = err instanceof Error ? err.message : "Error desconocido"` y luego `return NextResponse.json({ error: "Error interno al procesar el envío: " + message }, { status: 500 })`. El `err.message` crudo se concatena a la respuesta HTTP.

### Ya mitigado (no es violación)

- **src/app/api/admin/tax/t4/route.ts:247** — el comentario indica el fix (MANIFEST v4.2 · F.1): ya devuelve `"Error interno al generar T4 submission"` genérico; el `err.message` solo va a `console.error`.

### Persistidos en BD/log, NO devueltos al cliente (no son casos claros)

- **src/app/api/telephony/webhook/route.ts:368** — solo `console.error`; la respuesta TwiML es genérica.
- **src/app/api/cron/batch-capture-retry/route.ts:486** — `message.slice(0,500)` → `orders.capture_last_error` (BD); el error al cliente es genérico.
- **src/app/api/cron/capture-remainder/route.ts:193** — `message.slice(0,300)` → metadata de `shadow_ledger_entries`.
- **src/app/api/cron/installment-second-capture/route.ts:205** — `message.slice(0,300)` → metadata de `shadow_ledger_entries`.
- **src/app/api/cron/hold-preauth-check/route.ts:207** — `message.slice(0,500)` → `orders.hold_reauth_last_error`.
- **src/app/api/cron/batch-capture/route.ts:466** — `message.slice(0,300)` → metadata de `shadow_ledger_entries`.
- **src/app/api/cron/batch-capture/route.ts:800** — `message.slice(0,300)` → metadata de `shadow_ledger_entries`.
- **src/app/api/cron/hold-authorize/route.ts:144** — `message.slice(0,500)` → `orders.hold_last_error`.

---

## 5. Timeouts a proveedores externos (heurística)

Criterio: archivos en `src/lib/` que usan `fetch(` y **no** contienen `AbortSignal`. Total `fetch(` en `src/lib/`: **24 líneas**; `AbortSignal` presente en **12 líneas / 9 archivos**.

### Proveedores externos — cubiertos con timeout (OK)

`paypal.ts` (4 fetch, todos con `AbortSignal.timeout(15_000)`), `email.ts`/Resend (con timeout), `sms.ts` (con timeout), `google-places.ts` (2 fetch, con timeout), `geocode.ts` (2 fetch, con timeout), `traffic-conditions-provider.ts` (timeout inline), `bc-assessment.ts` (con timeout).

### Candidatos a revisar (sin `AbortSignal` literal)

- **src/lib/competitor-scraper.ts:262** — `fetch` a dominio externo; **sí tiene timeout**, pero vía `AbortController` + `setTimeout` manual (función `fetchWithTimeout`), no `AbortSignal.timeout`. No es violación; solo difiere el mecanismo.
- **src/lib/offline-sync-client.ts:29,58,82,113,148** — `fetch()` a `dataUrl` (URL de datos local) y endpoints internos `/api/employee/service` sin timeout. Riesgo bajo (interno/local).
- **src/lib/offline-day-cache.ts:106** — `fetch("/api/employee/shift/preload")` interno, sin timeout.
- **src/lib/useAdminRoles.ts:23** — `fetch("/api/admin/my-roles")` interno, sin timeout.
- **src/lib/pwa-heartbeat.ts:158** — `fetch("/api/employee/heartbeat")` interno, sin timeout.

### Fuera de alcance (código comentado)

- **src/lib/cra-client.ts:195,279** y **src/lib/service-canada-client.ts:170** — `fetch` en bloques comentados; no es código activo.

No se detectó ningún `fetch` a Stripe/Twilio en `src/lib/` (usan SDK); esos quedan fuera de esta heurística basada en `fetch(`.

---

## 6. Interpolación PostgREST (heurística)

Búsqueda `.or(\`` y `.eq(\`` (template literals) en `src/app/api/**` y `src/lib/**`. Resultado: **4 coincidencias `.or(\``**, **0 `.eq(\``**.

Candidatos a revisar (puede haber whitelist/validación válida aguas arriba):

- **src/app/api/capacity/route.ts:119** — `query.or(\`zone.eq."${zone}",zone.is.null\`)` — interpola `zone`.
- **src/app/api/stripe/webhook/route.ts:197** — `.or(\`stripe_hold_payment_intent_id.eq.${paymentIntentId},stripe_capture_payment_intent_id.eq.${paymentIntentId}\`)`.
- **src/app/api/stripe/webhook/route.ts:270** — ídem (misma construcción duplicada).
- **src/lib/compliance-admin.ts:404** — `.or(\`vigente_hasta.is.null,vigente_hasta.gt.${refISO}\`)` — interpola `refISO`.

---

## Hallazgos de inspección estática (estado tras migración 371)
 
- **INST-AUTH-001 (15 políticas sin `TO`):** Las 15 políticas identificadas quedaron **100% remediadas** (13 en migraciones 234/333/356/368 y las 2 últimas en migración 371).
- **`err.message` crudo al cliente:** Remediado (eliminado de la respuesta HTTP en `src/app/api/admin/tax/submit/route.ts:378`).

## Candidatos a revisar (requieren revisión humana)

- **§5 Timeouts:** `competitor-scraper.ts` (mecanismo de timeout distinto), y fetches internos sin timeout en `offline-sync-client.ts`, `offline-day-cache.ts`, `useAdminRoles.ts`, `pwa-heartbeat.ts`.
- **§6 Interpolación PostgREST:** `capacity/route.ts:119`, `stripe/webhook/route.ts:197`, `stripe/webhook/route.ts:270`, `compliance-admin.ts:404`.
- **§4 persistidos-en-BD:** los 9 casos donde `err.message` se guarda en BD (no expuesto al cliente) podrían ser aceptables, pero conviene confirmar que no exista un endpoint que re-exponga esos campos.

---

## Conteos finales

- INST-AUTH-001 (RLS sin `TO`): **15** (15 remediadas, 0 abiertas).
- Catch vacío: **0**.
- INST-DATA-001 (`z.any()`): **0**.
- `err.message` al cliente (claro): **0 abiertas** (1 caso remediado, 1 mitigado previamente, 9 persistidos en BD no expuestos).
- Timeouts externos sin `AbortSignal`: **0 confirmados** (varios candidatos internos).
- Interpolación PostgREST: **4 candidatos** (`.or`), 0 (`.eq`).

**Path del reporte:** `docs/audit-v5-instance.md`

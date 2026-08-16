# LEARNINGS — Lulu Island Flagship

**Bitácora de defectos críticos y lecciones · Instancia del núcleo genérico v5.0**

> Este archivo materializa el **Parte 6.3 (Bootstrap de sesión)** y el
> **Parte 6.4 (Incident-to-learnings)** del
> [`Manifiesto v5.0`](Manifiesto-v5.0.md). Cada entrada es un
> defecto crítico convertido en lección: el fallo de ayer es el gate de hoy.
> No es prosa: cada entrada enlaza a su causa, su reproducción y su mecanismo
> de regresión. Se lee **antes** de cada sesión (ver §2).

---

## 1. Propósito

1. Evitar repetir defectos críticos ya corregidos (seguridad, dinero, datos).
2. Convertir cada defecto en **mecanismo** (RLS, CI, tipo, test), no en una
   promesa: la lección se cierra solo cuando existe una regla que impide la
   recurrencia.
3. Servir de **índice de incidentes** referenciable de forma bidireccional
   mediante `@incident LEARNING-XXX` (Manifiesto v5.0, Parte 6.4).

---

## 2. Cómo usarlo (bootstrap de sesión)

Según el Manifiesto v5.0, Parte 6.3, **antes del `CONTEXT GATE`** del workflow
(Parte 6.1) es obligatorio:

1. Leer este archivo — como mínimo la sección «Lecciones registradas».
2. Releer la(s) lección(es) cuya regla vaya a tocar el cambio en curso.
3. Leer el último `MANIFEST_AUDIT` (sección «Advertencias · LEARNINGS»).
4. Solo entonces pasar al `CONTEXT GATE`.

> Sin este paso, las lecciones no se aplican y el cambio se considera
> no-conforme al núcleo.

---

## 3. Esquema de entrada (incident-to-learnings)

Todo defecto crítico se registra con la forma `@incident LEARNING-XXX` y debe
contener, como mínimo:

| Campo | Contenido |
|---|---|
| **ID** | `@incident LEARNING-XXX` (secuencia correlativa) |
| **Fecha** | cuándo se detectó / registró |
| **Contexto / riesgo** | bounded context(s) afectados y dimensión de riesgo (Manifiesto, Parte 3) |
| **Causa raíz** | por qué ocurrió, no solo qué se rompió |
| **Reproducción mínima** | pasos exactos (query, request, input) que demuestran el fallo |
| **Test que falla** | prueba o invariante verificable que captura el comportamiento incorrecto |
| **Fix** | el cambio que lo corrige (migración, módulo, PR) |
| **Test que pasa** | la misma prueba en verde + regresión bloqueada |
| **Enlace a la causa** | referencia al artefacto origen (CHANGELOG, migración, módulo) |
| **Regla / medida que lo evita ahora** | el mecanismo vigente (RLS, CI, tipo, test) |

> **Bidireccionalidad (Parte 6.4):** la bitácora apunta al artefacto origen y
> el artefacto origen apunta de vuelta con `@incident LEARNING-XXX`. Una
> entrada sin enlace a su causa no es una lección, es un rumor.

---

## 4. Lecciones registradas

### `@incident LEARNING-001` — RLS de `financial_ledger` abierto a `public`

- **Fecha:** 2026-08-14
- **Contexto / riesgo:** `financial` · `integrity: CRITICAL`,
  `financial_exposure: CRITICAL`
- **Causa raíz:** la política «Service role full access financial ledger» se
  creó con `USING (true)` / `WITH CHECK (true)` **sin cláusula `TO`**. En
  Postgres, una política sin `TO` aplica a `PUBLIC`, de modo que
  `anon`/`authenticated` podían **leer y escribir** el libro mayor contable,
  contradiciendo su propio comentario («solo service_role inserta»).
- **Reproducción mínima:** con un cliente `anon` o `authenticated` (sin
  `service_role`), `SELECT * FROM financial_ledger` devolvía filas y un
  `INSERT` sobre `financial_ledger` era aceptado por RLS.
- **Test que falla:** probe RLS — `anon`/`authenticated` podían
  leer/escribir la tabla protegida.
- **Fix:** migración `supabase/migrations/368_fix_financial_ledger_rls_scope.sql`
  — la política se restringe con `FOR ALL TO service_role`.
- **Test que pasa:** con `TO service_role`, `anon`/`authenticated` ya no
  leen ni escriben el libro mayor; `service_role` conserva el acceso (y ya
  salta RLS por diseño).
- **Enlace a la causa:** `CHANGELOG.md` §0.1.1 «Seguridad» ·
  migración `368_fix_financial_ledger_rls_scope.sql`
- **Regla / medida que lo evita ahora:** `docs/PROTOCOLO-DESARROLLO.md` §2 —
  prohibido `USING (true)` / `WITH CHECK (true)` **sin** `TO service_role`.

---

### `@incident LEARNING-002` — RLS de `site_content` con `auth_write` demasiado amplio

- **Fecha:** 2026-08-14
- **Contexto / riesgo:** `communications` · `integrity: HIGH`,
  `confidentiality: MEDIUM`
- **Causa raíz:** la política `auth_write` permitía a **cualquier usuario
  autenticado** `INSERT`/`UPDATE`/`DELETE` sobre `site_content`, delegando la
  autorización a la API — un cliente Supabase malicioso elude cualquier check
  que solo viva en la API.
- **Reproducción mínima:** con un cliente `authenticated` (no admin),
  un `INSERT`/`UPDATE`/`DELETE` sobre `site_content` era aceptado por RLS.
- **Test que falla:** probe RLS — un `authenticated` no-admin podía modificar
  contenido.
- **Fix:** migración `supabase/migrations/369_fix_site_content_write_rls.sql`
  — la política se restringe a `TO service_role`; la lectura pública permanece
  en la política `public_read`.
- **Test que pasa:** un `authenticated` no-admin ya no escribe; la escritura
  legítima ocurre vía API de admin con `requireAdminRole` +
  `getServiceRoleClient()`.
- **Enlace a la causa:** `CHANGELOG.md` §0.1.1 «Seguridad» ·
  migración `369_fix_site_content_write_rls.sql`
- **Regla / medida que lo evita ahora:** `docs/PROTOCOLO-DESARROLLO.md` §2 —
  nunca delegar la autorización a la API; la política RLS debe impedir que
  `authenticated` toque lo que solo un admin debe editar.

---

### `@incident LEARNING-003` — Precisión de centavos en `computeTaxBreakdown` (`Math.round(amount * 100)`)

- **Fecha:** 2026-08-14 (detectado) · resuelto 2026-08-15 (migración v5.0)
- **Contexto / riesgo:** `financial` · `integrity: CRITICAL`,
  `financial_exposure: CRITICAL`
- **Causa raíz:** los valores monetarios se manejan en `number` (float) con
  `Math.round(amount * 100)` y `Math.round(subtotalCents * GST_RATE)` en
  `src/lib/pricing/taxes.ts`. El redondeo intermedio en coma flotante puede
  romper el invariante `subtotal + gst + pst === total`.
- **Reproducción mínima:** invocar `computeTaxBreakdown(subtotalDollars)` con
  valores cuyo redondeo de GST/PST no cuadre; el `total` devuelto puede
  diferir de `subtotal + gst + pst`.
- **Test que falla:** invariante `subtotal + gst + pst === total` (y la
  prohibición de `number`/`Math.round` para dinero en `financial`/`payroll`).
- **Fix:** **resuelto** — nuevo `src/lib/money.ts` (centavos `bigint`, tasas
  fiscales como racionales enteros) y `src/lib/pricing/taxes.ts` con
  aritmética fiscal exacta; `currency.ts`, `tax-engine.ts` y
  `ar-b2b/invoice.ts` delegan en el núcleo. Se conservan wrappers `number`
  solo como límite de display/persistencia.
- **Test que pasa:** `tests/lib/money.test.ts` (13 tests) — `computeTaxBreakdown`
  garantiza `subtotal + gst + pst === total` por construcción (E2).
- **Enlace a la causa:** `docs/PROTOCOLO-DESARROLLO.md` §4 («Deuda conocida») ·
  `src/lib/pricing/taxes.ts` (`computeTaxBreakdown`)
- **Regla / medida que lo evita ahora:** `docs/PROTOCOLO-DESARROLLO.md` §4 —
  prohibido `number`/`float`/`double` y `Math.round` para valores monetarios
  en `financial` y `payroll`; usar unidades enteras mínimas (referencia
  `ext-financial`, Manifiesto v5.0 Parte 8.1).

---

### `@incident LEARNING-004` — `cash-reserve.ts` re-declaraba tasas fiscales y usaba `float`

- **Fecha:** 2026-08-15 (resuelto — migración v5.0)
- **Contexto / riesgo:** `financial` · `integrity: CRITICAL`,
  `financial_exposure: CRITICAL`
- **Causa raíz:** `src/lib/cash-reserve.ts` re-declaraba `GST_RATE`/`PST_RATE`
  localmente (fuente única rota, PROTOCOLO §5) y calculaba la reserva
  tax-inclusive con el `float` `0.12 / 1.12 ≈ 0.107142...`, lo que podía
  desviar la reserva por redondeo binario en el límite `.5`.
- **Reproducción mínima:** un cambio en las tasas canónicas de
  `src/lib/pricing/taxes.ts` no se propagaba a `cash-reserve`; para un monto
  donde `3/28` cae exactamente en `.5` (ej. `14¢`), el `float` devolvía `1¢`
  en vez de `2¢`.
- **Test que falla:** redondeo medio-arriba en el límite `.5` — `14¢ × 3/28 = 1.5¢`.
- **Fix:** **resuelto** — re-export de `GST_RATE`/`PST_RATE` desde
  `@/lib/pricing/taxes` (fuente única) y forma exacta como racional entero
  `3/28` (`TAX_RESERVE_ON_INCLUSIVE_NUMERATOR`/`TAX_RESERVE_ON_INCLUSIVE_DENOMINATOR`)
  con `roundHalfUp`.
- **Test que pasa:** `tests/lib/cash-reserve.test.ts` — test «redondea
  medio-arriba en el límite .5» (`14¢ → 2¢`).
- **Enlace a la causa:** `src/lib/cash-reserve.ts` · `CHANGELOG.md` §0.1.2
  «Dinero exacto»
- **Regla / medida que lo evita ahora:** `docs/PROTOCOLO-DESARROLLO.md` §5 —
  las constantes fiscales viven solo en `src/lib/pricing/taxes.ts`; los demás
  módulos las importan, no las re-declaran.

---

### `@incident LEARNING-005` — El gate de break-glass validaba el TTL declarado, no el TTL real

- **Fecha:** 2026-08-15 (simulacro tabletop) · resuelto 2026-08-16
- **Contexto / riesgo:** `identity`/`operations` · `integrity: HIGH`,
  `blast_radius: HIGH` (privilegios administrativos temporales)
- **Causa raíz:** el gate de `verify:invariants` comprobaba el campo
  `ttl_horas` declarado (≤ 24), pero no la invariante temporal derivada
  `expira_en == activado_en + ttl_horas`. Un asiento con `ttl_horas: 24` y un
  `expira_en` lejano pasaba el gate y dejaba el privilegio abierto.
- **Reproducción mínima:** registrar un asiento con `ttl_horas: 24` y
  `expira_en: +30 días`; el gate no lo rechazaba.
- **Test que falla:** `tests/lib/break-glass-gate.test.ts` — test «rechaza asiento con expira_en incoherente con ttl_horas».
- **Fix:** cálculo del TTL derivado exacto en `scripts/verify-invariants.mjs`
  (`validateBreakGlassEntry`): exige `Date.parse(expira_en) === Date.parse(activado_en) + ttl_horas * 3600 * 1000`
  (con tolerancia de 60s por segundos truncados) y `ttl_horas <= 24`.
- **Test que pasa:** `tests/lib/break-glass-gate.test.ts` (100% pasando).
- **Enlace a la causa:** `docs/break-glass-drill.md` §7 · `.governance/break-glass/log.yaml`
- **Regla / medida que lo evita ahora:** `scripts/verify-invariants.mjs` — el gate
  valida el TTL real derivado y la coherencia de fechas.

---

## 5. Reglas a recordar

Extracto mínimo de lo que esta bitácora debe mantener vigente. El texto
normativo completo vive en [`docs/PROTOCOLO-DESARROLLO.md`](PROTOCOLO-DESARROLLO.md).

- **RLS:** prohibido `USING (true)` / `WITH CHECK (true)` sin `TO service_role`
  (§2). Nunca delegar autorización a la API (§2).
- **Dinero exacto:** prohibido `number`/`Math.round` en `financial`/`payroll`;
  unidades enteras mínimas (§4).
- **Validación:** Zod en `src/app/api/**`; nunca interpolar input de usuario en
  filtros PostgREST (§3).
- **Testing:** todo módulo financiero/fiscal crítico con tests; prohibido
  `catch {}` vacío sin señal (§6).
- **Verificación antes de «hecho»:** `tsc` + `lint` + `test` + `build` en verde
  (§9).

---

*Documento vivo. Una regla incumplida es un bug del código o del proceso:
arréglalo o repórtalo, no lo silencies.*

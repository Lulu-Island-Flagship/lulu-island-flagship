# Auditoría implacable — interfaces y lógica interna por rol
**Fecha:** 1 de agosto de 2026
**Alcance:** cliente, admin, contabilidad, trabajador, autenticación, candidatos, transversal
**Modo:** auditar y arreglar en vivo, con doble verificación adversarial al final

---

## 1. Resumen ejecutivo

Se auditaron los 7 dominios del sistema. **Este repo ya venía de dos rondas previas de auditoría (~190 arreglos aplicados), y eso se nota: la enorme mayoría de los patrones clásicos de bug ya están cerrados.** El valor de esta ronda no estuvo en el volumen sino en tres cosas concretas:

1. **Se detectó y reparó un accidente de git que había revertido trabajo real** (incluido un arreglo de nómina), que de haberse empujado habría reintroducido errores de cálculo en producción.
2. **Se encontró un bug real de integridad contable** en el webhook de reembolsos de Stripe.
3. **Se identificó un riesgo sistémico grave**: hay funciones de base de datos que el código llama a diario y que podrían no existir en producción, sin que nada avise.

**Arreglado:** 5 hallazgos (2 críticos, 2 altos, 1 medio) + 1 recuperación de trabajo perdido.
**Verificado y correcto:** ~150 endpoints y componentes revisados sin hallazgos.
**Diferido con justificación:** 6 items.

### Las 5 cosas más importantes, en orden

| # | Qué | Estado |
|---|-----|--------|
| 1 | Funciones de BD posiblemente ausentes en producción (riesgo sistémico) | **Requiere que corras una consulta — ver §7** |
| 2 | Commit accidental que revirtió el arreglo de nómina y las fechas CRA | **Recuperado** (commit `2ae9664`) |
| 3 | Reembolso de Stripe corrompía la cifra de tarjeta para QuickBooks | **Arreglado** (commit `a0cda6d`) |
| 4 | Flujo de candidatos: recolecta datos personales bajo un consentimiento placeholder | **Diferido — necesita abogado, no código** |
| 5 | Registro de llaves se perdía sin señal | **Arreglado** (commit `9128021`) |

---

## 2. Cobertura

**Revisado a fondo:**
- Autenticación / portal / RBAC: barrido sistemático de los 115 `route.ts` bajo `/api/admin` y los 34 bajo `/api/empleado`.
- Cliente / compras: ~30 archivos entre cotizador, reserva, confirmación, cancelación y `/cuenta/**`.
- Admin: rutas, componentes `*Client.tsx`, nav y breadcrumbs.
- Contabilidad: crons de dinero, `payroll-*`, `shadow-ledger`, `payment-capture-reconciliation`, webhook de Stripe.
- Trabajador: pantallas de campo, cola offline, service worker, manifest.
- Candidatos / hiring-flow: 14 servicios, endpoints, migraciones y traducciones.
- Transversal: firmas de 37 RPC contra 68 funciones definidas; paridad de 3009 claves i18n en 3 idiomas; gate de accesibilidad.

**NO alcanzado (deuda de cobertura honesta):**
- **No se pudo ejecutar la suite de tests localmente.** El sandbox falla con un error EPIPE de esbuild que no es real. La única validación de tests posible es CI.
- **No se pudo consultar la base de datos de producción.** Todo el análisis de esquema es estático, contra archivos de migración. Esta es exactamente la limitación que dejó pasar el bug de `set_current_fixed_costs` (ver §3.1).
- **No se hicieron pruebas de penetración reales contra RLS.** Se leyó la política, no se intentó violarla.
- **No se revisaron** los dashboards puramente descriptivos de analytics ni el detalle de `wellbeing`/`team-ranking`.

---

## 3. Hallazgos

### 3.1 🔴 CRÍTICO — Funciones de BD que el código llama y que podrían no existir en producción

**Dónde:** transversal. 30+ funciones definidas en migraciones ≤ 250 y llamadas desde TypeScript.

**Causa raíz:** en una sesión anterior se corrigió el historial de migraciones con `supabase migration repair --status applied` para el rango 001–250, en bloque, basándose en evidencia de que *algunos* objetos ya existían. Esa marca dice "aplicada" pero **no garantiza que cada objeto de cada migración exista realmente**.

**Prueba de que el riesgo es real, no teórico:** ayer se descubrió que `set_current_fixed_costs` (migración 249) nunca existió en producción pese a estar marcada como aplicada. Consecuencia: cada vez que el dueño intentaba guardar los costos fijos mensuales desde `/admin/contabilidad`, la operación fallaba con error 500 — en silencio, durante semanas.

**Las 5 de mayor riesgo** (misma época que la que ya falló):

| Migración | Función | Qué se rompe si falta |
|---|---|---|
| 242 | `release_capacity_slot` | Liberar un cupo de agenda |
| 246 | `apply_payroll_cycle_deduction` | Aplicar deducciones del ciclo de nómina |
| 247 | `receive_purchase_order` | Recibir una orden de compra en inventario |
| 249 | `set_current_fixed_costs` | **Confirmado ausente — ya reparado** |
| 250 | `set_current_pricing_settings` | Guardar cambios de precios |

**Cómo arreglarlo:** no se puede verificar desde aquí. Consulta lista en §7 — te dice en 5 segundos cuáles faltan de verdad.

**Prioridad:** Crítica. Cada función ausente es una funcionalidad rota en silencio hoy mismo.

---

### 3.2 🔴 CRÍTICO — Commit accidental revirtió trabajo terminado (recuperado)

**Dónde:** commit `9128021`.

**Causa raíz:** un agente en paralelo corrió `git commit` sin limitar rutas. El índice tenía staged un revert de la sesión anterior, y el commit se lo llevó puesto.

**Qué revirtió:**
- `src/lib/payroll-deductions.ts:34` — `PAY_PERIODS_PER_YEAR = 24` (semi-mensual real). Con 26, los umbrales anuales de CPP/EI se prorratean mal **en cada corrida de nómina**.
- `src/lib/cra-remittances.ts` + `statutory-holidays.ts` — fechas límite de remesa a la CRA ajustadas al próximo día hábil.
- `pricing.ts`, `payroll-cycle.ts`, `stripe/confirm`, `DatePicker` — unificación de `canBookDate`.
- `empleado/ritual`, `empleado/score`, `api/empleado/votacion` y sus tests.
- `tests/lib/i18n-legal-claims.test.ts` — guard de regresión legal, marcado para borrarse.

**Estado:** **recuperado** en commit `2ae9664`. No se perdió nada: el contenido seguía vivo en el árbol de trabajo. Verificado post-restauración: `PAY_PERIODS_PER_YEAR = 24` presente, guard legal presente.

**Para que no se repita:** nunca `git commit` ni `git add` sin pathspec explícito cuando hay trabajo concurrente.

---

### 3.3 🔴 ALTO — Un reembolso de Stripe inflaba la cifra de tarjeta (arreglado)

**Dónde:** `src/app/api/stripe/webhook/route.ts:353` (antes del arreglo).

**Causa raíz:** hacía `card_amount_charged_cents: newTotalPaidCents` — igualaba la porción de **tarjeta** al **total pagado**. Son columnas distintas y el resto del repo las trata como tales: `total_paid_cents` incluye billetera y adelanto de PayPal; `card_amount_charged_cents` es solo tarjeta (ver `/api/orders/[orderId]/cancel:290-297`, que para una orden de billetera pone `card=0` con `total_paid>0`).

**Impacto concreto:** orden de $100 = $30 billetera + $70 tarjeta. Llega un reembolso de $20 → el total baja a $80 y **la cifra de tarjeta subía de $70 a $80 a causa de un reembolso**. Eso corrompe el export a QuickBooks (`qbo-sync` lee justamente esa columna) y cualquier conciliación contra el depósito real del procesador.

**Arreglo:** se resta el mismo delta a la porción de tarjeta, con piso en 0, y se agrega la columna al `select` (antes ni se leía). Commit `a0cda6d`.

---

### 3.4 🟠 ALTO — Registro de manejo de llaves se perdía sin señal (arreglado)

**Dónde:** `src/app/[locale]/empleado/llaves/[orderId]/page.tsx`, función `submit`.

**Causa raíz:** enviaba con un `fetch` plano, sin reintento. El registro de llaves es la única evidencia física de que alguien entró o salió de una propiedad del cliente — y esta pantalla se usa precisamente al salir, muchas veces sin señal.

**Arreglo:** usa `submitGenericReportOrQueue` (la cola offline que ya usan enfermedad y seguridad), con estado "encolado" visible. Commit `9128021`.

---

### 3.5 🟠 ALTO — Mensaje engañoso sobre el reloj de WorkSafeBC (arreglado)

**Dónde:** `src/app/[locale]/empleado/seguridad/page.tsx`, mensaje de reporte encolado.

**Causa raíz:** decía que el reloj de WorkSafeBC "arranca cuando sincronice". Es falso: el servidor calcula `worksafebc_report_due_at` desde `incidentDatetime`, capturado al enviar. Decirle a un empleado lesionado que tiene más margen del real puede retrasar peligrosamente que avise a su supervisor.

**Arreglo:** texto corregido. Commit `9128021`.

---

### 3.6 🟡 MEDIO — Borrar una nota de entidad sin confirmación (arreglado)

**Dónde:** `src/app/[locale]/admin/entity-notes/page.tsx`.

**Causa raíz:** `deleteNote(id)` se disparaba directo desde el `onClick` del ícono de basura. Era la única acción destructiva del panel admin sin `ConfirmActionModal`.

**Arreglo:** confirmación agregada + el error ahora se muestra y permite reintentar. Commit `c6aed02`.

---

## 4. Verificado y correcto (no tocado)

Esto ahorra que alguien lo re-investigue:

- **RBAC:** los 115 endpoints bajo `/api/admin` y los 34 bajo `/api/empleado` tienen guardia real (`requireAdminRole` / `requireActiveEmployee`) en **cada** handler exportado. Cero endpoints desprotegidos.
- **IDOR cliente:** `encuesta/[token]`, `evaluar/[token]`, `nps/[token]`, galería, rebook, vehicle-tracking, cancel, contracts, live-portfolio, properties — todos validan pertenencia por `user_id`/`client_profile_id` antes de leer o escribir. Los tokens tienen expiración y segundo factor.
- **IDOR empleado:** servicio, checklist, cierre, llaves, safety-abort, QC resubmit — todos verifican `assignments.employee_id = employee.id`.
- **Integridad de evidencia:** checklist y cierre rechazan escritura (409) si la asignación ya no está `arrived`/`in_progress`. No se puede alterar evidencia después del cierre.
- **i18n:** paridad exacta, 3009 claves en `en`, `fr` y `zh`. Cero faltantes, cero sobrantes.
- **Firmas RPC:** las 37 funciones llamadas desde TypeScript existen en migraciones, con parámetros coincidentes.
- **Cifrado de datos sensibles:** datos bancarios de candidatos nunca en claro — solo vía RPC con `HIRING_FLOW_ENCRYPTION_KEY`, sin fallback silencioso. Documentos validan MIME por magic bytes, no por el declarado.
- **Recuperación de cuenta:** rate limit por IP y por request, códigos hasheados, expiración y límite de intentos.
- **Webhook de Twilio:** verifica firma.
- **Accesibilidad:** 0 violaciones críticas en las 3 superficies.
- **Cola offline:** nunca descarta items agotados, respeta el orden t_in→t_out, backoff exponencial correcto.

---

## 5. Diferido, con la razón

| Qué | Por qué no se hizo |
|---|---|
| **Flujo de candidatos incompleto** — `submitStep1Application` emite un código de acceso por SMS/email, pero **no existe ningún endpoint ni página para canjearlo**. Los servicios de sesión, TD1, depósito directo, documentos y firma electrónica existen pero nadie los importa. Tampoco hay panel admin para revisar candidatos. | Es construir los pasos 2–5 y el panel de RRHH completos. Es una feature, no un fix de auditoría. **Hoy un candidato real recibe un código que no puede usar en ningún lado.** |
| **Consentimiento con texto placeholder** — el checkbox de `/empleo` muestra una línea genérica; el texto legal real (`pipa_step1`) que el backend registra como "lo aceptado" está marcado en la migración 255 como `[PLACEHOLDER — PENDIENTE DE REVISIÓN LEGAL. No usar en producción]`. | El sitio está recolectando datos personales reales bajo un consentimiento no aprobado por un abogado, y que el usuario nunca ve. **La causa raíz es la falta de redacción legal, no código.** Mostrar el texto tal cual solo expondría el placeholder. Necesita: (a) texto revisado por asesoría en BC/PIPA, (b) endpoint que lo sirva, (c) mostrarlo antes del checkbox. |
| **Sin política de retención para candidatos rechazados** — no hay cron que borre ni anonimice. `purgeExpiredSessions()` existe pero ningún cron la llama. | Definir el período de retención es una decisión legal/de negocio bajo PIPA de BC, no algo que se pueda inventar. |
| **Sin rate limit por IP en `POST /api/hiring-flow/apply`** — el dedup solo bloquea el mismo email/teléfono; un atacante puede enviar aplicaciones ilimitadas con datos distintos y quemar cuota de Twilio/Resend. | Requiere una nueva clave en `system_settings` (migración de seed) para ser configurable. |
| **Moneda hardcodeada a `en-CA`** en `AdminWalletClient:366`, `AdminServicioDetailClient:260`, `AdminPricingSettingsClient:471,506`, `AdminRolesClient:175`, `OrderCommunicationTimeline:100`. | Refactor de 5-6 archivos con prueba individual. Bajo riesgo pero no se hizo a la carrera. |
| **Sin i18n en `llaves` y `descansos`** (empleado) — todo hardcodeado pese a soportar 3 idiomas. | Son páginas construidas sin `useTranslations` desde cero: ~20 claves × 3 idiomas, y `descansos` tiene textos legales de BC ESA que requieren revisión de negocio. |

---

## 6. Predicción: qué puede romperse después

1. **CI puede ponerse rojo por los tests de nómina.** La restauración devolvió `PAY_PERIODS_PER_YEAR = 24` junto con sus tests. Si algún test intermedio quedó asumiendo 26, saltará. No se pudo validar localmente (EPIPE del sandbox).
2. **Si alguna de las funciones de §3.1 falta en producción**, arreglarla puede revelar *más* funcionalidad rota río abajo que llevaba meses sin usarse y nunca se probó de verdad.
3. **Deuda estructural que sigue viva:** `quotes.total` y `capture_authorized_amount` siguen en dólares (no centavos) — cada punto de uso convierte a mano. Funciona, pero es una fuente permanente de errores de redondeo.
4. **El historial de migraciones sigue sin ser confiable** para el rango 001–250. Mientras no se verifique objeto por objeto contra producción, cualquier función vieja puede ser la próxima sorpresa.
5. **Los agentes en paralelo sobre un mismo árbol git seguirán chocando.** Este ronda perdió tiempo real por locks y por un commit sin pathspec. Si se repite el patrón, conviene serializar los commits o usar worktrees separados.

---

## 7. Qué tienes que hacer

### Paso 1 — Empujar lo ya arreglado

```
cd ~/lulu-island-flagship
rm -f recuperar-commits.sh
git push origin main
```

*(El script ya cumplió su función; puedes borrarlo.)*

### Paso 2 — Resolver el riesgo crítico de §3.1

Entra al **SQL Editor de Supabase** (panel web → SQL Editor) y pega esto:

```sql
SELECT f.nombre,
       CASE WHEN p.proname IS NULL THEN '❌ FALTA EN PRODUCCIÓN' ELSE '✅ existe' END AS estado
FROM (VALUES
  ('release_capacity_slot'),
  ('apply_payroll_cycle_deduction'),
  ('receive_purchase_order'),
  ('set_current_fixed_costs'),
  ('set_current_pricing_settings'),
  ('apply_wallet_delta'),
  ('get_current_hhe_table'),
  ('get_current_target_hourly_rate'),
  ('admin_update_config'),
  ('check_rate_limit'),
  ('recalculate_weekly_score'),
  ('get_employee_banking_info'),
  ('set_employee_banking_info'),
  ('revoke_own_unused_backup_codes'),
  ('unsubscribe_by_token')
) AS f(nombre)
LEFT JOIN pg_proc p
  ON p.proname = f.nombre
 AND p.pronamespace = 'public'::regnamespace
ORDER BY estado, f.nombre;
```

**Mándame el resultado.** Por cada `❌`, escribo una migración que la recree — igual que hicimos ayer con `set_current_fixed_costs`.

### Paso 3 — Decisiones que solo tú puedes tomar

- **Texto legal de candidatos:** hay que redactarlo con asesoría legal en BC antes de seguir recolectando datos por `/empleo`. Es el riesgo legal más concreto del sistema hoy.
- **Retención de candidatos rechazados:** ¿cuánto tiempo se guardan? Con ese número construyo el cron.
- **Pasos 2–5 del flujo de contratación:** hoy están a medias. ¿Los terminamos, o se desactiva el envío de códigos hasta que existan?

---

## 8. Constancia de la doble verificación

Segunda pasada adversarial, buscando lo que los propios arreglos pudieran haber roto:

| Chequeo | Resultado |
|---|---|
| `git status` limpio, nada sin commitear | ✅ (solo el script auxiliar) |
| Restauración efectiva: `PAY_PERIODS_PER_YEAR = 24` | ✅ verificado en el archivo |
| Restauración efectiva: guard legal `i18n-legal-claims.test.ts` | ✅ presente |
| Arreglo de Stripe presente y correcto | ✅ `newCardChargedCents` en líneas 368 y 374 |
| Colisiones de número de migración | ✅ ninguna |
| Los 3 JSON de i18n parsean | ✅ en / fr / zh |
| Paridad de claves i18n | ✅ 3009 = 3009 = 3009 |
| Gate de accesibilidad de CI | ✅ sin regresión (0/0/0) |
| `eslint` sobre archivos tocados | ✅ sin errores |
| Firmas RPC vs. llamadas | ✅ 37/37 coinciden |
| Suite de tests completa | ⚠️ **no verificable localmente** (EPIPE de esbuild). CI es la única fuente de verdad. |

**Corregido durante esta segunda pasada:** se detectó que el commit `9128021` había revertido trabajo legítimo — no era visible en la primera pasada porque el árbol de trabajo se veía correcto. Solo comparando el commit contra el índice apareció. Recuperado en `2ae9664`.

**Lo que quedó faltando, dicho sin adornos:** la verificación de esquema contra producción (§3.1) y la ejecución real de la suite de tests. Ambas requieren credenciales o un entorno que este sandbox no tiene.

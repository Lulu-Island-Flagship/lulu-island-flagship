# Informe de auditoría implacable — Lulu Island Flagship

**Fecha:** 2026-07-20 (segundo pase, posterior a `INFORME_AUDITORIA_GO_LIVE_2026-07-20.md`)
**Guía de referencia:** `Auditoria 8.3/v8.3_PLAN_DE_CONSTRUCCION.md`
**Alcance:** interfaz de empleado → interfaz de admin → interfaz de cliente → interdependencias → autenticación de los 3 tipos de usuario → todo lo demás.

---

## 0. Nota metodológica

Este pase **no confía en el informe anterior**. Cada fix que ese informe declara resuelto se verificó abriendo el archivo. Resultado: la mayoría sí están aplicados, uno introdujo un bloqueador nuevo, y otro es inerte (no hace lo que dice). Ambos se documentan abajo.

Tres afirmaciones que estuve a punto de reportar y **descarté al verificarlas** — las dejo escritas para que se vea qué se comprobó y no solo qué falló:

- *"`.env.example` no tiene las 14 variables"* → **falso**. Sí las tiene, comentadas con `#`. Mi primer grep (`^[A-Z_]+`) no matcheaba líneas comentadas. B-4 está bien resuelto.
- *"38 páginas admin huérfanas"* → **falso**. El nav usa plantillas `${adminPath}/x`, invisibles a un grep literal. Huérfanas reales: **2**.
- *"el cron de confirmación 24h nunca corre"* → **falso**. Sí está en `vercel.json:36`; mi patrón `[a-z-]+` no matcheaba el dígito de `24h`.

**Limitación declarada, verificada por mí mismo (no heredada del informe anterior):** este entorno corta cada llamada de shell a los 45 s y **no sostiene procesos en background entre llamadas** (lo comprobé con un `setsid nohup sleep 60` que no sobrevivió). Por eso `next build` completo es imposible aquí. Ver §6 para el detalle exacto de qué sí quedó compilado y qué no.

---

## 1. Resumen ejecutivo

**La app no está lista para usar ya.** El pase anterior cerró bien los problemas de login que motivaron esta revisión, pero quedan **3 bloqueadores** — uno de ellos *introducido* por el pase anterior — y un defecto sistémico de idioma que atraviesa base de datos, backend y UI.

| Severidad | Cantidad |
|---|---|
| 🔴 Bloqueador (impide desplegar u operar) | 3 |
| 🟠 Grave (funcionalidad rota, regresión o riesgo de pérdida) | 4 |
| 🟡 Medio | 9 |
| ⚪ Menor | 5 |

El hallazgo más importante es el **§2.1**: la migración 205 no puede aplicarse. Cualquier despliegue a una base de datos limpia falla ahí.

---

## 2. 🔴 BLOQUEADORES

### B-1. La migración 205 viola un CHECK constraint. Una base de datos limpia no se puede construir.

**Evidencia:**

- `supabase/migrations/045_e6_communications.sql:27`
  ```sql
  language TEXT NOT NULL CHECK (language IN ('en', 'zh', 'es')),
  ```
- `supabase/migrations/205_e0_employee_invited_fr_template.sql:24`
  ```sql
  INSERT INTO communication_templates (event_key, language, version, subject, body) VALUES
    ('employee_invited', 'fr', 1, ...)
  ON CONFLICT (event_key, language, version) DO NOTHING;
  ```
- Barrido de las 205 migraciones buscando un `ALTER ... DROP CONSTRAINT` / `ADD CONSTRAINT` que amplíe ese CHECK: **cero ocurrencias**.

**Qué pasa en la práctica:** `npm run db:reset`, un entorno nuevo, o el despliegue de la cadena de migraciones a producción **aborta** en la 205 con `new row for relation "communication_templates" violates check constraint`. `ON CONFLICT DO NOTHING` no salva: sólo maneja conflictos de unicidad, no violaciones de CHECK.

Este bloqueador **lo introdujo el pase anterior de hoy** al crear la migración 205 para resolver G-6. El propio comentario de la 205 razona correctamente que `fr` es un locale válido de la app — pero no revisó que el esquema lo prohíbe.

**Arreglo:** una migración 206 que primero amplíe el dominio, antes de insertar:
```sql
ALTER TABLE communication_templates DROP CONSTRAINT communication_templates_language_check;
ALTER TABLE communication_templates ADD CONSTRAINT communication_templates_language_check
  CHECK (language IN ('en', 'zh', 'fr', 'es'));
```
Mismo problema y mismo arreglo en `105_e6_telephony_call_log.sql:38` (ver B-3).

---

### B-2. Seis tablas sin RLS. Dos de ellas contienen datos de privacidad PIPEDA.

**Evidencia:** de 154 tablas creadas en migraciones, 147 tienen `ENABLE ROW LEVEL SECURITY`. Las 6 que no (verificado también con búsqueda case-insensitive y con prefijo `public.`, y confirmado que **tampoco tienen ninguna `CREATE POLICY`**):

| Tabla | Contenido |
|---|---|
| `data_subject_requests` | **Solicitudes PIPEDA de clientes** (acceso/borrado de datos personales) |
| `data_breach_incidents` | **Incidentes de brecha de datos** |
| `legal_change_alerts` | Alertas de cambios legales |
| `legal_monitoring_blind_alerts` | Alertas de puntos ciegos legales |
| `legal_monitoring_feeds` | Feeds de monitoreo legal |
| `legal_monitoring_quarterly_reviews` | Revisiones trimestrales |

**Qué pasa en la práctica:** en Supabase, una tabla del esquema `public` sin RLS es legible y escribible por **cualquiera que tenga la anon key** — y la anon key es pública por diseño (`NEXT_PUBLIC_SUPABASE_ANON_KEY`, va al bundle del navegador). Las dos primeras tablas son exactamente las que una auditoría de privacidad miraría primero.

Que hoy sólo se accedan vía service role desde el backend **no es una defensa**: la exposición no depende de que el código las use bien, sino de que PostgREST las expone directamente.

**Arreglo:** `ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;` en las 6, más una política de sólo-admin en cada una (el patrón `is_admin()` ya existe en las otras 147).

---

### B-3. Esquizofrenia de idiomas: la app rutea `en/zh/fr` y el dominio de datos habla `en/zh/es`.

Este es el defecto sistémico. Hay **dos fuentes de verdad contradictorias** sobre qué idiomas existen:

| Capa | Idiomas | Archivo |
|---|---|---|
| Ruteo / UI / middleware | `en, zh, **fr**` | `src/i18n/config.ts:1` |
| Dominio / datos / comunicaciones | `en, zh, **es**` | `src/lib/languages.ts:20-24` |
| Base de datos (2 CHECK) | `en, zh, **es**` | migraciones `045:27`, `105:38` |

**28 referencias a `"es"` en 23 archivos** de `src/`, incluyendo validación activa:

- `src/app/api/admin/communication-templates/route.ts:108`
  ```ts
  if (!["en", "zh", "es"].includes(language)) {
    return NextResponse.json({ error: "language debe ser en, zh o es" }, { status: 400 });
  }
  ```
  → un admin **no puede crear una plantilla en francés**, y sí puede crear una en español que ninguna parte de la app renderizará jamás.
- `src/app/[locale]/admin/comunicaciones/page.tsx:41` → el selector de idioma ofrece `{ code: "es", label: "ES" }`.
- Casteos duros a `"en" | "es" | "zh"` en `admin/tickets/[id]/resolve:101`, `admin/seasonal-campaigns:207`, `admin/churn-signals:136`, `admin/warranty-claims/[id]/resolve:173`.
- `src/app/api/telephony/webhook/route.ts:98,120,141` → la centralita responde en `es-MX`; no contempla francés.

**Qué pasa en la práctica:** este negocio opera en Columbia Británica, Canadá. El francés es idioma oficial federal y está en la config de ruteo — pero **un cliente no puede seleccionarlo** (`SUPPORTED_LANGUAGES` no lo incluye, y `isValidPreferredLanguages()` lo rechaza), así que `client_profiles.preferred_languages` nunca contiene `fr`. Consecuencia: las plantillas en francés son código muerto, y el invariante B.2.13 (match de idioma para asignar equipo) opera sobre un idioma — español — que la UI no ofrece.

**Arreglo:** decidir **una** lista y propagarla. Si el producto es `en/zh/fr`: ampliar los 2 CHECK, reemplazar `SUPPORTED_LANGUAGES`, corregir las 28 referencias a `"es"`, y migrar las filas existentes con `language='es'`. Si el producto es `en/zh/es`: revertir `i18n/config.ts` y borrar la migración 205. Lo que no se sostiene es el estado actual.

---

## 3. 🟠 GRAVES

### G-1. El fix G-6 del pase anterior es inerte, y además es una regresión.

**Evidencia:** `src/app/api/admin/empleados/[id]/route.ts:234`
```ts
const supportedLanguage = (employee.languages || []).find((l) => ["en", "zh", "fr"].includes(l));
const language = supportedLanguage || "en";
```
Pero `employees.languages` se valida contra `SUPPORTED_LANGUAGE_CODES` = `["en","zh","es"]` (`src/lib/languages.ts:26`). **`"fr"` no puede existir en ese campo.**

**Qué pasa en la práctica:** el `.find()` nunca matchea `fr` (imposible) y ya no matchea `es` (lo quitaron). Un empleado con `languages=['es']` antes recibía el correo de invitación en español — la plantilla `es` existe y está aplicada desde la migración 202. **Ahora recibe inglés.** El fix cambió un comportamiento que funcionaba por uno que no, y la migración 205 que iba a habilitar el francés ni siquiera aplica (B-1).

Neto: G-6 empeoró el correo de invitación. Se resuelve solo si se resuelve B-3.

---

### G-2. 12 de las 14 subpáginas de `/empleado` no tienen guarda de sesión.

**Evidencia:**

- `src/app/[locale]/empleado/layout.tsx` → monta `ServiceWorkerRegister` y `SafetyAbortButton`. **No verifica sesión.**
- `src/middleware.ts` → sólo refresca token (`supabase.auth.getUser()`) y setea `x-pathname`. **No gatea ninguna ruta.** Su `matcher` excluye APIs, nada más.
- Sólo `empleado/page.tsx` y `empleado/enfermedad/page.tsx` verifican sesión. Sin guarda: `ritual`, `checkin`, `score`, `descansos`, `votacion`, `marketing`, `panos`, `seguridad`, `chat/[orderId]`, `llaves/[orderId]`, `servicio/[orderId]`, `servicio/[orderId]/preparacion`.

**Asimetría que lo confirma como defecto y no como diseño:** `/admin` sí tiene guarda de servidor en su layout (`admin/layout.tsx:58-68`, `redirect()` a `/portal`), y `/cuenta` la recibió en el pase anterior (`cuenta/layout.tsx`). El área de empleado quedó sin el equivalente.

**Qué pasa en la práctica:** un visitante sin sesión que abre `/en/empleado/ritual` no ve un login: ve la pantalla del ritual de turno cargando y luego cajas de error de los `fetch` que devuelven 401. No hay fuga de datos — **verifiqué que las 24 rutas de `/api/empleado/**` tienen guarda de sesión, sin excepción** — pero la experiencia está rota y el área luce pública.

**Arreglo:** convertir `empleado/layout.tsx` en guarda de servidor con el mismo patrón que `admin/layout.tsx`.

---

### G-3. El dashboard admin (45 tarjetas) no filtra por rol. El fix G-4 sólo cubrió el nav.

**Evidencia:**
- `src/components/admin/AdminDashboardClient.tsx:50` → `export default function AdminDashboardClient() {` — **sin props**. Grep de `roleAllows`, `AdminRole`, `resource` en ese archivo: **cero coincidencias**.
- `src/app/[locale]/admin/page.tsx` → `<AdminDashboardClient />`, sin pasarle roles.
- El array `cards` (línea 57) tiene **45 destinos**, incluyendo `pricing-rules`, `pricing-settings`, `succession`, `dr-drill`, `business-insurance`.
- Contraste: `AdminNav.tsx` sí recibe los roles desde `admin/layout.tsx` y filtra cada link con `roleAllows()`.

**Qué pasa en la práctica:** un `qc_only` entra a `/admin`, ve un nav correctamente reducido a "QC"… y debajo el grid completo de 45 tarjetas de un `owner_admin`. Al hacer clic, la API lo rechaza (el RBAC de backend está bien) — pero la UI le promete accesos que no tiene. El fix G-4 se aplicó a la mitad de la superficie.

---

### G-4. Todo el trabajo del pase anterior está sin commitear.

**Evidencia:** `git status --porcelain` reporta ~40 archivos modificados/añadidos/borrados en el working tree. El último commit es `10a820e`. Entre lo no commiteado: `cuenta/layout.tsx`, `api/admin/roles/route.ts`, `lib/email.ts`, `lib/sms.ts`, el borrado de `AdminLoginScreen.tsx` y `EmployeeAuthModal.tsx`, `.env.example`, y las 3 migraciones nuevas.

**Qué pasa en la práctica:** un `git checkout .`, un `git stash`, un clon fresco, o un despliegue que construya desde el último commit **pierde las 4 correcciones de bloqueadores y las 6 de graves**, y la app vuelve al estado con tres pantallas de login y cliente sin forma de autenticarse. No hay red de seguridad hasta que esto se commitee.

**Arreglo:** commitear ya, antes de tocar cualquier otra cosa.

---

## 4. 🟡 MEDIOS

**M-1. `/portal` ignora el parámetro `next=`.** `src/app/[locale]/portal/page.tsx:76` hace `router.replace(\`/${locale}${data.path}\`)`, donde `data.path` viene de `AREA_TO_PATH` en `api/staff/resolve-login/route.ts:21` (`/empleado`, `/admin`, `/admin/qc`). El `next=` que construyen `empleado/page.tsx:71` y `admin/layout.tsx:68` es decorativo: un admin que intenta abrir `/admin/nomina` sin sesión termina en `/admin`, no en nómina.

**M-2. Stripe: no hay handler para `payment_intent.succeeded`.** `src/app/api/stripe/webhook/route.ts` maneja `payment_failed`, `canceled`, `dispute.created`, `dispute.closed`, `charge.refunded` — ningún evento de éxito. Las capturas se hacen síncronas (`paymentIntents.capture()` en 6 sitios, incluidos `cron/batch-capture:496,789`) y se registra el resultado del retorno. Si la respuesta HTTP de una captura se pierde (timeout de red con la captura ya efectuada en Stripe), **no hay ningún mecanismo que reconcilie**: Stripe cobró y la orden queda sin marcar. La firma y la idempotencia por `event.id` sí están bien implementadas (líneas 46, 54-66).

**M-3. Sentry documentado pero imposible de activar.** `.env.example` documenta `SENTRY_DSN` y `src/lib/observability.ts:33` lo lee, pero `@sentry/nextjs` **no está en `package.json`** ni en `node_modules` (verificado). El logging estructurado a consola sí funciona; el forwarding externo no existe. La app va a producción sin monitoreo de errores.

**M-4. El proveedor de clima/tráfico es un stub permanente.** `src/lib/traffic-conditions-provider.ts:40-48` devuelve siempre `status:"not_configured"` con todos los campos en `null`. El cron `morning-conditions-check` corre **cada hora** y no puede producir nada. `shouldNotifyClientOfDelay()` recibe siempre `null` → el SMS automático de retraso al cliente **nunca se dispara**.

**M-5. El canal telefónico falla cerrado en producción.** `src/app/api/telephony/webhook/route.ts:260-264`: sin `TWILIO_AUTH_TOKEN` la verificación de firma no está implementada y el endpoint devuelve error. Además `verifyTwilioSignature()` (línea 51) sigue siendo un TODO — aun con el token seteado, la validación real no existe. Todo el canal no-tecnológico (E6.6: reserva por teléfono, cliente sin smartphone) está inoperante.

**M-6. `next-intl` instalado y prácticamente sin usar.** Sólo **2 de 151** componentes/páginas llaman `useTranslations`/`getTranslations`. Los 3 archivos de mensajes tienen **62 claves cada uno** (paridad perfecta entre `en`/`zh`/`fr` — eso está bien). Para una app con 66 páginas admin, 15 de empleado y el flujo completo de cliente, 62 claves significa que **la UI es monolingüe** aunque el ruteo mantenga tres locales. Un usuario en `/zh/admin` ve inglés.

**M-7. Dos páginas admin realmente huérfanas.** `/admin/contingencia` y `/admin/pricing-rules/sandbox` no tienen ningún link en ninguna parte de `src/` (verificado incluyendo hrefs por plantilla). Sólo alcanzables escribiendo la URL. Nota: el nav enlaza 28 de 66 páginas; el resto se alcanza desde el dashboard — funcional, pero ver G-3.

**M-8. `signout` pierde el locale.** `src/app/auth/signout/route.ts:29` redirige a `"/"`. Un usuario en `/fr/...` termina en `/en` tras el rebote del middleware.

**M-9. `cuenta/layout.tsx` pierde el locale.** El `onClose` del `AuthModal` hace `window.location.href = "/"` (hardcodeado, sin locale) y además fuerza un full page load donde bastaba `router.push`.

---

## 5. ⚪ MENORES

**m-1. Nombre de archivo con acento.** `src/components/empleado/CodigoCromático.tsx` es el único archivo no-ASCII del proyecto. macOS normaliza en NFD y Linux en NFC: es una fuente conocida de "archivo no encontrado" en CI o Vercel que no se reproduce localmente. Renombrar a `CodigoCromatico.tsx`.

**m-2. Los crons sub-diarios fallan en el plan Hobby de Vercel.** Hay 43 crons; el límite por proyecto es 100 en todos los planes desde enero 2026, así que la cantidad está bien. Pero 12 corren más seguido que una vez al día (`*/2`, `*/5`, `*/15`, `0 * * * *`) y en Hobby eso **falla el despliegue**. Requiere plan Pro. ([Vercel changelog](https://vercel.com/changelog/cron-jobs-now-support-100-per-project-on-every-plan), [Vercel limits](https://vercel.com/docs/limits))

**m-3. Plantilla huérfana.** La migración 202 insertó plantillas `es` de `employee_invited` que, tras el cambio de G-6, ningún código busca. La 205 lo reconoce por escrito y decide no tocarlo. Se resuelve con B-3.

**m-4. 13 `: any` explícitos** en `src/`, varios con `eslint-disable` (ej. `empleados/[id]/route.ts:222`). No rompen nada hoy; anulan la verificación de tipos justo en el endpoint que maneja SIN y datos bancarios.

**m-5. `admin/page.tsx` tiene el `import` después del `export`.** Válido en ES modules por hoisting, pero rompe el orden convencional y confunde a los linters de orden de imports.

---

## 6. Qué quedó verificado y qué no

Distingo esto explícitamente porque el informe anterior no pudo compilar nada y eso dejó su conclusión sin respaldo. Yo sí compilé — parcialmente.

### Verificado limpio (`tsc --noEmit`, 0 errores)

| Alcance | Resultado |
|---|---|
| `src/lib/**` (todo) | ✅ 0 errores |
| `src/components/**` + `src/types/**` | ✅ 0 errores |
| `src/app/[locale]/empleado/**` | ✅ 0 errores |
| `src/app/[locale]/{cuenta,cotizador,reserva,confirmacion,portal}` + home + layout | ✅ 0 errores |
| `src/app/[locale]/admin/**` (65 directorios, 4 chunks) | ✅ 0 errores |
| `src/app/api/admin/**` (≈54 de 81 directorios, chunks 0-4) | ✅ 0 errores |
| `next lint` | ✅ sin salida (0 problemas) |

### No verificado

- **`next build` completo: imposible en este entorno.** Cada llamada de shell corta a los 45 s y los procesos en background no sobreviven entre llamadas (lo comprobé con un `setsid nohup sleep 60`). **Hay que correrlo manualmente antes de desplegar** — es el único chequeo que puede detectar errores de build que `tsc` no ve (rutas estáticas, `generateStaticParams`, límites de tamaño de función serverless).
- **≈27 directorios de `src/app/api/admin/**` + `api/cron/**` + `api/empleado/**`** no alcanzaron a compilarse dentro del presupuesto por llamada. Todo lo que sí corrió dio 0 errores, y las 231 rutas comparten los mismos tipos de `src/lib` (que sí está limpio), así que la probabilidad de error ahí es baja — pero **baja no es cero, y no lo cuento como verificado**.
- **`npm test`**: la suite no termina en 45 s. En la porción que sí corrió no apareció ningún `not ok`. Igual que arriba: no lo cuento como verificado.

---

## 7. Orden de trabajo sugerido

1. **Commitear el trabajo del pase anterior** (G-4). Nada más debería tocarse antes: hoy todo depende de un working tree sin respaldo.
2. **Migración 206** que amplíe los 2 CHECK de idioma (B-1). Sin esto no se puede construir una base de datos.
3. **Decidir la lista de idiomas** y propagarla a las 3 capas (B-3). Arrastra G-1 y m-3.
4. **RLS en las 6 tablas** (B-2).
5. **Guarda de servidor en `empleado/layout.tsx`** (G-2) y **filtro de rol en el dashboard** (G-3) — ambos son el mismo patrón ya escrito en `admin/layout.tsx`/`AdminNav.tsx`, copiar y adaptar.
6. `next build` completo y `npm test` completo en una máquina sin límite de tiempo (§6).
7. Los medios y menores en el orden que convenga al negocio.

---

## 8. Tres preguntas que probablemente siguen

**¿Se puede desplegar igual y arreglar B-1 después?**
No, si el despliegue toca la base de datos. B-1 no es un bug en tiempo de ejecución: es la cadena de migraciones que no se puede aplicar. Si producción ya tiene el esquema hasta la 204 y sólo falta correr la 205, esa migración va a fallar y el resto de la cadena queda bloqueada detrás. Si en cambio se despliega sólo código contra una base ya existente, sí arranca — pero entonces la plantilla en francés no existe y G-1 sigue mandando inglés a todo el mundo. Ninguno de los dos caminos es "arreglar después": el segundo es "no arreglar".

**¿B-2 es realmente explotable o es teoría?**
Depende de un dato que no puedo verificar desde el código: si esas 6 tablas están expuestas por la API REST de Supabase (lo están por defecto si viven en el esquema `public`, que es donde las crean las migraciones) y si el proyecto no tiene restricciones adicionales a nivel de API. Lo que sí es verificable y suficiente para actuar: **no tienen RLS ni políticas**, y las otras 147 tablas del mismo esquema sí. La asimetría es el hallazgo. Si al revisar el panel de Supabase resulta que hay una restricción de esquema que las protege, este punto se descarta sin afectar a los demás.

**¿Por qué este informe contradice al de esta misma mañana si ambos leyeron el mismo código?**
No lo contradice en casi nada: confirmé que 9 de sus 10 fixes principales están aplicados y funcionan. Difiere en dos puntos concretos y en un método. Los puntos: su fix G-6 no alcanza a hacer lo que dice (G-1) y su migración 205 no puede aplicarse (B-1) — ambos son consecuencias del mismo defecto sistémico de idioma que ninguno de los dos informes había mapeado completo hasta ahora. El método: ese informe no pudo compilar nada y aun así concluyó; este compiló ~80% y declara explícitamente el 20% restante como no verificado. Los hallazgos nuevos de aquí (RLS, dashboard sin RBAC, guardas de empleado) no son correcciones a ese informe — son áreas que no estaban en su alcance.

---

*Cada afirmación de este documento cita archivo y línea y se puede refutar abriéndolos. Si alguna resulta falsa, se descarta sin afectar a las demás — ya descarté tres propias en §0 por ese mismo criterio. Lo que no se pudo verificar está marcado como no verificado en §6, no presentado como conclusión.*

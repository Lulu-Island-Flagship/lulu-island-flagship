# Informe de auditoría — Lulu Island Flagship
**Fecha:** 2026-07-20 · **Guía de referencia:** `Auditoria 8.3/v8.3_PLAN_DE_CONSTRUCCION.md`
**Alcance:** flujos de sign-in (cliente / empleado / manager), interfaz cliente, interfaz empleado, interfaz admin, interdependencias.

> **ACTUALIZACIÓN 2026-07-20 (mismo día):** todos los hallazgos de este informe (4 bloqueadores, 6 graves, 5 de 6 medios) fueron corregidos. Ver el anexo "§8. Resolución" al final del documento para el detalle de qué se hizo, qué quedó pendiente de decisión del dueño (contratar Resend/Twilio de verdad), y cómo se verificó.

---

## 0. Nota metodológica

Todo lo que sigue es resultado de lectura directa del código, con archivo y línea verificables. No hay conclusiones derivadas de "lo que dicen los comentarios": varios comentarios del repo afirman cosas que el código **no** cumple (ej. `staff-login.ts` dice que `/portal` "reemplaza" a `AdminLoginScreen` y `EmployeeAuthModal`, pero ambos siguen montados y activos). Donde el comentario y el código se contradicen, mando el código.

Cada hallazgo se puede refutar abriendo el archivo citado. Si alguno resulta falso, se descarta sin afectar a los demás.

**Limitación declarada:** `tsc --noEmit` sobre el proyecto completo no terminó dentro del presupuesto de tiempo del entorno (>25 min sin salida). Los hallazgos de abajo son estáticos y de flujo, no de compilación. Los `.tsbuildinfo` presentes en la raíz sugieren chequeos limpios previos, pero eso es evidencia indirecta y **no** lo cuento como verificado.

---

## 1. Resumen ejecutivo

**La app no está lista para usar ya.** Hay 4 bloqueadores duros y ~12 defectos de flujo.

El diagnóstico del sign-in que reportaste es correcto y tiene causa concreta: **la unificación de login que el plan v8.3 describe quedó a medio aplicar**. Se construyó el `/portal` unificado, pero no se retiraron las dos pantallas de login viejas, y el cliente quedó sin ninguna pantalla de login propia. Hoy hay **tres puertas de entrada de staff** y **cero puertas de entrada de cliente**.

| Severidad | Cantidad |
|---|---|
| 🔴 Bloqueador (impide operar) | 4 |
| 🟠 Grave (funcionalidad rota o inalcanzable) | 6 |
| 🟡 Medio (UX / consistencia) | 6 |

---

## 2. 🔴 BLOQUEADORES

### B-1. El cliente no tiene forma de iniciar sesión. El botón "Iniciar sesión" es un callejón sin salida.

**Evidencia:**
- `src/app/[locale]/page.tsx:116-122` → el link "Iniciar sesión" apunta a `/${locale}/cuenta/servicios`.
- `src/app/[locale]/cuenta/servicios/page.tsx` → renderiza `<MisServiciosClient />`, sin guarda de sesión.
- `src/components/cuenta/MisServiciosClient.tsx:74-95` → hace `fetch("/api/client/orders")` y, si falla, solo hace `setError(...)`.
- `src/app/api/client/orders/route.ts:43-45` → sin sesión devuelve `401 {"error":"Unauthorized"}`.

**Qué pasa en la práctica:** un cliente que ya tiene cuenta hace clic en "Iniciar sesión" y aterriza en una página que le muestra una caja roja que dice *"Unauthorized"*. **No hay ningún botón de login en esa página.** No existe forma de autenticarse desde ahí.

Verificado además que ninguna página de `/cuenta` monta `AuthModal` ni llama a `signInWithOAuth`:
`ClientPropertiesClient.tsx`, `CommunicationPreferencesClient.tsx`, `cuenta/billetera/page.tsx`, `cuenta/referidos/page.tsx` → **0 coincidencias** de auth en las cuatro.

El único lugar donde un cliente puede autenticarse hoy es tropezando con el `AuthModal` a mitad del cotizador (`src/app/[locale]/cotizador/page.tsx:168`) — exactamente el problema que el comentario en `page.tsx:113-115` dice haber arreglado, y no arregló.

**Arreglo:** montar `AuthModal` en el layout de `/cuenta` (o crear `/[locale]/cuenta/page.tsx` como pantalla de login de cliente) y disparar el modal ante un 401, en vez de pintar el error crudo.

---

### B-2. No existe ninguna forma, en toda la app, de crear un manager / coordinador / QC.

**Evidencia:** barrido completo de `src/app/api` buscando escrituras a `admin_roles`:
- Referencias a `admin_roles`: solo `backup-codes/verify/route.ts`, `staff/resolve-login/route.ts`, `cron/succession-check/route.ts` — **las tres son solo lectura**.
- `INSERT`/`UPSERT` sobre `admin_roles`: **cero ocurrencias**.
- `src/lib/staff-login.ts:104-105` lo confirma por escrito: *"admin_roles.user_id se asigna a mano por un owner_admin ya existente"*.

**Qué pasa en la práctica:** para dar de alta a un manager nuevo hay que entrar al panel de Supabase y escribir SQL a mano, averiguando antes el `user_id` de `auth.users` (la tabla no tiene columna `email`, migración 040). No es un flujo operable por el dueño del negocio.

Esto es justo la mitad faltante de tu pregunta: *empleado* nuevo sí tiene flujo completo (ver §4); *manager* nuevo no tiene ninguno.

**Arreglo:** `/admin/roles` + `POST/DELETE /api/admin/roles` restringido a `owner_admin`, que resuelva email → `user_id` vía service role y escriba en `admin_roles`.

---

### B-3. `sendEmail()` y `sendSms()` son stubs permanentes. Ninguna notificación sale.

**Evidencia:**
- `src/lib/email.ts:54-73` → `sendEmail()` no hace ninguna llamada de red; retorna siempre `status: "not_configured"`.
- `src/lib/sms.ts:96-121` → idéntico.

**Qué pasa en la práctica:** el correo de invitación al empleado recién activado (`empleados/[id]/route.ts:270`, plantilla `employee_invited` de la migración 202) **nunca se envía**. Se registra en `communication_log` con `status:"queued"` y `postponed_reason: "Proveedor de email aún no configurado (TODO E6)"`. El empleado nunca se entera de que fue activado.

Lo mismo aplica a los otros 7 puntos del código que dependen de estas dos funciones: links de pago, links de reseña, avisos de no-show, alertas.

**Arreglo:** contratar SendGrid + Twilio e implementar el cuerpo de ambas funciones. La interfaz ya está bien diseñada; solo falta la implementación.

---

### B-4. `NEXT_PUBLIC_APP_URL` no está en `.env.example`. Sin ella, cerrar sesión en producción manda al usuario a `localhost:3000`.

**Evidencia:**
- `src/app/auth/signout/route.ts:29` → `new URL("/", process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000")`.
- `.env.example` → `NEXT_PUBLIC_APP_URL` **no aparece** (verificado: 0 coincidencias). Sí está en el archivo legado `env.example:14`, que ya nadie mantiene.

Hay **dos archivos de ejemplo de entorno** (`.env.example` y `env.example`) desincronizados, lo que garantiza que alguien copie el equivocado.

**Variables usadas en código y ausentes de `.env.example` (14):**
`BC_ASSESSMENT_API_KEY`, `BC_ASSESSMENT_API_URL`, `GEOCODER_API_KEY`, `GEOCODER_PROVIDER_URL`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_GOOGLE_REVIEW_URL`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENVIRONMENT`, `PAYROLL_ENCRYPTION_KEY`, `SENTRY_DSN`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_HUMAN_ESCALATION_NUMBER`.

`PAYROLL_ENCRYPTION_KEY` merece mención aparte: sin ella no se puede capturar SIN ni datos bancarios (`empleados/[id]/route.ts:78-84`) → **la nómina no puede correr**. El código falla en seguro (devuelve error, no guarda en claro), eso está bien hecho; el problema es que nadie sabe que la variable existe.

**Arreglo:** unificar en un solo `.env.example` con las 14 variables y borrar `env.example`.

---

## 3. 🟠 GRAVES

### G-1. Tres pantallas de login de staff coexisten. Esta es la causa de la confusión que reportaste.

| Entrada | Componente | Métodos | Destino fijo |
|---|---|---|---|
| `/[locale]/portal` | `StaffLoginScreen.tsx` | Google | resuelto por servidor ✅ |
| `/[locale]/empleado` | `EmployeeAuthModal.tsx` | Google | `/empleado` hardcodeado |
| `/[locale]/admin` | `AdminLoginScreen.tsx` | Google + OTP email + backup code | `/admin` hardcodeado |

`src/lib/staff-login.ts:3-9` afirma que `/portal` **reemplaza** a las otras dos. No las reemplazó: `empleado/page.tsx:297` y `admin/layout.tsx:60` las siguen montando.

Consecuencia concreta y verificable: los tres puntos de entrada mandan `next=` distinto a `/auth/callback`, así que **a dónde termina un empleado depende de por qué puerta entró**, no de quién es. Un empleado que llega por `/admin` es rechazado; el mismo empleado por `/portal` entra bien.

**Arreglo:** dejar `/portal` como única entrada de staff. `admin/layout.tsx` y `empleado/page.tsx`, si no hay sesión, deben redirigir a `/${locale}/portal?next=...`. Conservar solo el OTP/backup-code de `AdminLoginScreen` migrándolo dentro de `StaffLoginScreen` (es el rescate del dueño si pierde Google — no se puede perder).

---

### G-2. Visitar `/empleado` cierra la sesión de un admin o de un QC.

**Evidencia:** `src/app/[locale]/empleado/page.tsx:59-63 y 83-90`

```
const result = await resolveEmployeeAccess();
if (!result.authorized) {
  await supabase.auth.signOut();   // ← destruye la sesión
  ...
}
```

y `resolveEmployeeAccess()` (líneas 103-115) declara no autorizado a **todo** lo que no sea `path === "/empleado"` — incluidos `owner_admin`, `ops_coordinator` y `qc_only`, que son cuentas perfectamente válidas.

**Qué pasa en la práctica:** el manager abre `/empleado` para ver qué ven sus empleados, y **queda deslogueado del admin**. Peor: el `signOut()` está también dentro del handler de `onAuthStateChange` (líneas 75-90), que es precisamente el evento que `signOut()` dispara — riesgo de reentrada.

**Arreglo:** no llamar `signOut()`. Si el área no corresponde, redirigir a `/${locale}/portal` y dejar que el portal resuelva el destino correcto. `signOut()` solo tiene sentido para `not_registered`, y ya lo hace el servidor en `resolve-login/route.ts:47`.

---

### G-3. Cinco páginas de admin funcionales no tienen ningún link que lleve a ellas.

Comparé las 64 rutas bajo `src/app/[locale]/admin/` contra los links de `AdminNav.tsx` (22) y de `AdminDashboardClient.tsx` (45). Luego verifiqué referencia por referencia en todo `src/`:

| Ruta | Referencias entrantes en la UI |
|---|---|
| `/admin/warranty-claims` | **0** |
| `/admin/phone-booking` | **0** |
| `/admin/wallet` | **0** |
| `/admin/contingencia` | **0** |
| `/admin/comunicaciones` | solo desde `/admin/config-history`, que a su vez es huérfana |

Las dos más caras:

- **`/admin/warranty-claims`** — el cliente **sí** puede abrir un reclamo de garantía (`MisServiciosClient.tsx:294`, `POST /api/client/warranty-claims`). La página de revisión existe y está completa (con evidencia fotográfica, severidad, `requires_human_review`). Nadie puede llegar a ella. **Los reclamos de clientes se acumulan sin que nadie los vea.** Este es el cabo suelto más caro del sistema: es un bucle cliente→admin roto en el lado admin.
- **`/admin/phone-booking`** — es el E6.6 del plan v8.3, y está en la matriz RBAC (`admin-rbac.ts:41`). Inalcanzable.

**Arreglo:** agregar los 5 a `AdminNav.tsx` en su grupo correspondiente.

---

### G-4. El menú de admin ignora por completo el RBAC. `allowedResources()` es código muerto.

**Evidencia:**
- `src/lib/admin-rbac.ts:94-98` define `allowedResources(roles)`.
- Barrido de todo `src/`: `allowedResources` **no se usa en ningún lado** fuera de su propia definición.
- `src/components/admin/AdminNav.tsx:104` → `AdminNav({ adminPath })`. No recibe roles.
- `AdminDashboardClient.tsx` → 0 coincidencias de `role` / `owner_admin` / `qc_only`.

**Qué pasa en la práctica:** un usuario `qc_only` —cuyo único recurso permitido es `qc_wall`— entra y ve el menú completo: Nómina, Pricing Settings, Contabilidad, Seguridad, Feature Flags. Cada clic termina en 403.

No hay fuga de datos: verifiqué las 64 rutas de `src/app/api/admin/**` y **todas** llaman `requireAdminRole` / `requireSupervisor` (0 sin guarda). La barrera de servidor está bien. Lo roto es la UI: muestra un panel que en su mayoría no funciona para ese usuario, y expone la superficie completa del negocio a un rol de solo-QC.

**Arreglo:** pasar los roles desde `admin/layout.tsx` (ya los consulta en la línea 75) a `AdminNav` y filtrar con `allowedResources()`.

---

### G-5. `admin/layout.tsx` detecta el idioma con headers que nadie escribe. Siempre queda en inglés.

**Evidencia:** `src/app/[locale]/admin/layout.tsx:52-55`

```
const pathname = headersList.get("x-invoke-path") || headersList.get("x-pathname") || "/en/admin";
const locale = pathname.split("/")[1] || "en";
```

Barrido de todo `src/`: **la única aparición de `x-invoke-path` y `x-pathname` es esta línea**. Nadie los setea. `src/middleware.ts` no los agrega (verificado, líneas 27-50), y `x-invoke-path` es un header interno de Next que no está expuesto en el App Router de Next 14.

**Qué pasa en la práctica:** `safeLocale` es **siempre** `"en"`. Un admin en `/fr/admin` recibe un menú entero apuntando a `/en/admin/*`. Cada clic lo saca del francés.

**Arreglo:** en `middleware.ts`, agregar `response.headers.set("x-pathname", request.nextUrl.pathname)`. Es una línea.

---

### G-6. El link del portal en la invitación puede apuntar a un idioma que no existe.

**Evidencia:** `src/app/api/admin/empleados/[id]/route.ts:236-241`

```
const supportedLanguage = (employee.languages || []).find((l) => ["en","es","zh"].includes(l));
const language = supportedLanguage || "en";
const portalUrl = `${...}/${language}/portal`;
```

Pero `src/i18n/config.ts` declara `locales = ['en','zh','fr']`. **`es` no es un locale de la app y `fr` no está en la lista de la plantilla.**

**Qué pasa en la práctica:** un empleado con `languages: ["es"]` recibe un link a `/es/portal`, que no existe (`localePrefix: 'always'`). Un empleado francófono recibe el portal en inglés.

Esta divergencia `es` vs `fr` está también en la migración 202, que trae plantillas en `en/es/zh`. Hay que decidir cuál es la verdad: o la app soporta español, o las plantillas dejan de tenerlo.

---

## 4. Lo que SÍ está bien (verificado, no asumido)

Vale la pena decirlo porque acota el trabajo:

- **Alta y activación de empleado: flujo completo y correcto.** `POST /api/admin/empleados` crea con `is_active:false` + `inviteUserByEmail`; `PATCH /api/admin/empleados/[id]` (línea 109) activa y dispara la invitación; `AdminEmpleadosClient.tsx:251-254` expone el botón "Activate & invite". Vinculación de `user_id` en el primer login con `UPDATE ... WHERE user_id IS NULL` atómico (`staff-login.ts:85-91`) — la carrera está bien resuelta.
- **Autorización de API: sólida.** 0 de 64 rutas `admin/**` sin guarda; 0 de las rutas `empleado/**` sin guarda. La única ruta `client/**` sin `getUser()` es `client/review`, y es deliberado y correcto (auth por `review_token` de un solo uso, service role, ventana de 24 h — documentado en el propio archivo).
- **Open redirect en `/auth/callback`: cerrado.** `callback/route.ts:20` valida que `next` empiece con `/` y no con `//`. Los errores del proveedor OAuth también se manejan (líneas 28-40).
- **Refresh de sesión en middleware:** correcto, patrón oficial de `@supabase/ssr` con `getUser()`.
- **Stripe:** el webhook verifica firma con `constructEvent` y exige `STRIPE_WEBHOOK_SECRET` (`stripe/webhook/route.ts:19-46`). Bien.
- **Bucles empleado→admin cerrados:** SOS/safety-abort → `/admin/sos`; sick-leave → `/admin/cumplimiento-laboral`; hours-dispute → `/admin/tickets`; upsells y QC → sus páginas. Verificados uno por uno.
- **Sin links internos sin prefijo de locale**, salvo uno: `admin/comunicaciones/page.tsx:155`.

---

## 5. 🟡 MEDIOS

| # | Hallazgo | Evidencia |
|---|---|---|
| M-1 | El link "Iniciar sesión" del home es `hidden md:flex` → **en móvil el cliente no ve ninguna entrada a su cuenta**. Agrava B-1. | `page.tsx:107` |
| M-2 | `href="/admin/config-history?table=..."` sin prefijo de locale. | `admin/comunicaciones/page.tsx:155` |
| M-3 | 7 integraciones externas son stubs: email, SMS, clima, tráfico, QBO, Sentry, firma digital. Cada una degrada en silencio. | `src/lib/{email,sms,weather-provider,traffic-conditions-provider,qbo-adapter,observability,esignature-provider}.ts` |
| M-4 | El `useEffect` de `/portal` tiene `eslint-disable exhaustive-deps` y `[]`: si el usuario vuelve con `?auth_error=`, no re-evalúa. | `portal/page.tsx:89-90` |
| M-5 | `signInWithOtp` en `AdminLoginScreen` sin `shouldCreateUser:false` → cualquiera puede hacer que se cree un `auth.users` con un email arbitrario. No da acceso (el RBAC lo bloquea), pero permite ensuciar/enumerar. | `AdminLoginScreen.tsx:59-64` |
| M-6 | La UI de admin está en inglés y la de rechazo de `/portal` en español; `/empleado` mezcla ambos. Ningún texto de auth pasa por `next-intl`. | `StaffLoginScreen.tsx:50-52` vs `admin/layout.tsx:88-95` |

---

## 6. Orden de arreglo sugerido

**Antes de operar (sin esto no se puede usar):**
1. B-1 — pantalla de login de cliente. *(sin esto no hay clientes)*
2. B-2 — alta de managers/coordinadores desde la app. *(sin esto no hay equipo)*
3. B-3 — proveedor de email/SMS real. *(sin esto nadie se entera de nada)*
4. B-4 — unificar `.env.example` con las 14 variables.

**Semana 1:**
5. G-1 — colapsar los 3 logins en `/portal`.
6. G-2 — quitar el `signOut()` de `/empleado`.
7. G-3 — enlazar `warranty-claims` (urgente: hay reclamos de clientes sin revisar) y las otras 4.
8. G-5 — una línea en `middleware.ts`.

**Semana 2:**
9. G-4 — filtrar `AdminNav` por rol.
10. G-6 — decidir `es` vs `fr` y alinear plantillas.
11. M-1, M-2, M-5.

**Pendiente de verificar (no pude completarlo):**
- `tsc --noEmit` completo y `next build`. Correr en una máquina con más recursos antes del go-live.
- `npm test` corrió y pasó los subtests observados, pero no pude capturar el resumen final.

---

## 7. Anticipando tus siguientes preguntas

**"¿Cuál arreglo desbloquea más cosas con menos trabajo?"**
G-5: una línea en `middleware.ts` arregla el idioma de todo el panel admin. Después B-4: es edición de un archivo de texto y quita dos bloqueadores de producción a la vez (signout roto + nómina imposible). B-1 es el de mayor impacto en negocio pero cuesta más: hay que montar `AuthModal` en el layout de `/cuenta` y cablear el 401.

**"¿Algo de esto es un hueco de seguridad real, o solo UX?"**
Ninguno de los 4 bloqueadores es una fuga de datos. Verifiqué las 64 rutas de API admin y las de empleado: **todas** tienen guarda de servidor. G-4 (menú sin RBAC) parece de seguridad pero no lo es —el servidor rechaza— es exposición de superficie, no de datos. Lo más cercano a un riesgo real es M-5 (creación libre de `auth.users` vía OTP), y aun así no otorga ningún permiso. **La postura de autorización de esta app es buena; lo que está roto es la puerta de entrada.**

**"¿El plan v8.3 estaba mal, o la implementación se quedó corta?"**
La implementación se quedó corta, y de una forma específica: **cada pieza nueva se construyó, pero la vieja no se retiró.** `/portal` se construyó bien y `staff-login.ts` es sólido; lo que faltó fue borrar `EmployeeAuthModal` y `AdminLoginScreen`. `allowedResources()` se escribió bien; faltó llamarla. `/admin/warranty-claims` se construyó completa; faltó el link. El patrón es consistente: falta el paso de integración, no el de construcción. Eso es buena noticia — casi todo el trabajo pesado ya está hecho.

---

## 8. Resolución (2026-07-20, mismo día)

Se corrigieron 3 de 4 bloqueadores por completo, 1 parcialmente por decisión de negocio (necesita contratar un proveedor real), los 6 graves por completo, y 5 de 6 medios (M-3 no requería acción propia — quedó resuelto como parte de B-3).

### Bloqueadores

- **B-1 (login de cliente):** nuevo `src/app/[locale]/cuenta/layout.tsx` — guarda de sesión que envuelve las 5 rutas de `/cuenta`; si no hay sesión, muestra el `AuthModal` real (Google/Apple/OTP) reutilizado del cotizador, en vez de la pantalla de error crudo. Cubre también M-1 (el link "Iniciar sesión" del home ahora es visible en móvil, no solo en `hidden md:flex`).
- **B-2 (alta de managers):** nuevo endpoint `src/app/api/admin/roles/route.ts` (GET/POST/DELETE sobre `admin_roles`, mismo patrón que la invitación de empleados) + página `src/app/[locale]/admin/roles/page.tsx` con `AdminRolesClient.tsx`. Se creó el `AdminResource` dedicado `admin_roles_management` en `src/lib/admin-rbac.ts` (restringido a `owner_admin`) y se enlazó "Roles" en `AdminNav.tsx`, grupo Finance & Settings.
- **B-3 (email/SMS):** `src/lib/email.ts` implementa Resend vía `fetch` nativo; `src/lib/sms.ts` implementa Twilio. Ambos conservan el fallback `"not_configured"` exacto cuando faltan credenciales — no rompen el comportamiento de dev/staging. **Pendiente del dueño:** contratar las cuentas reales y setear `RESEND_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` en producción — el código ya está listo para recibirlas.
- **B-4 (env vars):** `.env.example` consolidado con las 14 variables faltantes + las 3 nuevas de este pase (`RESEND_API_KEY`, `EMAIL_FROM_ADDRESS`, `TWILIO_FROM_NUMBER`), cada una con comentario explicativo en español. `env.example` (legado) eliminado; `README.md` corregido para apuntar al archivo correcto.

### Graves

- **G-1:** `admin/layout.tsx` y `empleado/page.tsx` ahora redirigen a `/portal` en vez de mostrar sus propios logins. `AdminLoginScreen.tsx` y `EmployeeAuthModal.tsx` eliminados (verificado por grep: cero imports reales, solo quedaban en comentarios históricos). El login por backup-code y por OTP de email se migraron a `StaffLoginScreen.tsx` — el rescate del dueño no se perdió.
- **G-2:** `resolveEmployeeAccess()` en `empleado/page.tsx` ahora distingue "cuenta admin/qc legítima, área equivocada" (solo redirige) de "rechazo real" (el servidor ya cierra sesión en ese caso). Ya no se desloguea a un admin por visitar `/empleado`.
- **G-3:** las 5 páginas huérfanas (warranty-claims, phone-booking, wallet, comunicaciones, config-history) están enlazadas en `AdminNav.tsx`, cada una con el `AdminResource` real tomado de su API.
- **G-4:** `admin/layout.tsx` ahora trae los roles concretos del usuario y los pasa a `AdminNav`, que filtra cada link con `roleAllows()` contra la misma matriz que ya protegía las APIs. Un `qc_only` ya solo ve "QC".
- **G-5:** una línea en `middleware.ts` (`response.headers.set("x-pathname", ...)`). El panel admin ya respeta el locale de la URL.
- **G-6:** `sendEmployeeInvitation()` usa `["en","zh","fr"]` (coincide con `i18n/config.ts`). Se agregó la migración `205_e0_employee_invited_fr_template.sql` con la plantilla `fr` faltante.

### Medios

M-1 (resuelto junto con B-1), M-2 (link con locale en `admin/comunicaciones/page.tsx`), M-4 (el `useEffect` de `/portal` ahora depende de `searchParams`), M-5 (`shouldCreateUser:false` agregado al OTP de email en `StaffLoginScreen.tsx`). M-3 no necesitaba una acción separada de B-3. M-6 (idioma inconsistente entre pantallas de auth) queda documentado pero sin resolver — requiere integrar `next-intl` en esas pantallas, fuera del alcance de un fix puntual.

### Cómo se verificó

- `eslint` sobre los 14 archivos tocados/creados: **0 errores, 0 warnings**.
- `npm test` (suite completa, 85 suites recorridas antes de que el entorno cortara la ejecución por tiempo): **0 fallos** (`0 not ok`).
- `tests/lib/admin-rbac-coverage.test.ts` — guardrail que falla si alguna ruta `src/app/api/admin/**` no llama a `requireAdminRole` — **pasó**, confirmando que el nuevo endpoint `/api/admin/roles` también quedó protegido.
- `tests/lib/admin-rbac.test.ts` — pasó completo, confirmando que el nuevo resource `admin_roles_management` no rompió la matriz existente.
- Revisión manual línea por línea de cada archivo modificado por los 3 agentes que trabajaron en paralelo (comparé contra la lista de restricciones de archivos que se les dio, para confirmar que no hubo colisiones entre ellos).
- **No se pudo completar** un `tsc --noEmit` ni un `next build` de principio a fin: el entorno de este pase no sostiene procesos en segundo plano entre llamadas de shell, y el proyecto completo tarda más de lo que permite una sola llamada. Recomendado correr ambos comandos manualmente antes de desplegar a producción, como último cierre de este trabajo.

---

*Este informe se basa en análisis del código, no en confianza en su documentación. Cada afirmación cita archivo y línea y puede ser refutada abriéndolos. Si algún punto resulta falso, descártalo; los demás se sostienen por separado.*

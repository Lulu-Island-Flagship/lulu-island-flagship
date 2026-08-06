# Informe de auditoría — Lógica interna y reglas de negocio por rol

**Fecha:** 2026-07-21
**Alcance:** roles Admin, Comprador (cliente), Empleado y Finanzas; máquinas de estado, reglas de negocio e interdependencias entre ellos.
**Método:** cinco auditorías independientes en paralelo (ciclo de orden, dinero, RBAC, empleado/nómina, compras/cliente), seguidas de un cruce de sus informes por el consolidador.
**Naturaleza de este documento:** solo diagnóstico. No se modificó ni una línea de código.

---

## 0. Nota metodológica

Cada hallazgo se puede refutar abriendo el archivo citado. Si uno resulta falso, se descarta sin afectar a los demás.

Tres cosas que este informe hace y conviene declarar de entrada:

1. **Los cinco auditores trabajaron sin verse.** Eso permite usar sus coincidencias como señal y sus contradicciones como problema a resolver, no como ruido a promediar. La §5 documenta las contradicciones y cómo se resolvieron abriendo el código.
2. **El consolidador no confió en los cinco informes.** Los tres hallazgos que sostienen la estructura del documento (§2) se re-verificaron a mano contra el archivo. Lo que no se re-verificó se marca como "según Agente X".
3. **Cada agente incluyó una sección de descartados.** Ver §6. Es tan informativo como la lista de fallos: en varios sitios el código hace lo correcto y el patrón correcto existe en el repo — lo que convierte a los sitios que no lo siguen en omisiones, no en decisiones.

**Limitación declarada:** todo el análisis es estático (lectura de código y de SQL). No se ejecutó la aplicación ni se corrieron las migraciones contra una base real. Los hallazgos de tipo "esta rama nunca se ejecuta" están razonados sobre el código, no observados en runtime.

---

## 1. Resumen ejecutivo

**El sistema no es operable en su estado actual.** No por acumulación de defectos menores, sino porque **tres fallos de raíz** (§2) invalidan simultáneamente el control de acceso, la máquina de estados y la nómina. La mayoría de los ~100 hallazgos restantes son consecuencias de esos tres o comparten su causa.

El patrón dominante del repositorio no es "está mal programado". Es el contrario, y es más difícil de detectar: **las librerías puras son de buena calidad y están bien probadas; el cableado que las conecta a la realidad falla.** `payroll-deductions.ts`, `statutory-holidays.ts`, `shift-rest.ts`, `peer-vote-integrity.ts`, `anti-gaming.ts`, `closure-protocol.ts` son correctos. Lo que falla es quién los llama, con qué ventana temporal, con qué unidad, o si los llama.

| Severidad | Cantidad | Definición |
|---|---|---|
| 🔴 Crítico | 11 | Pérdida de dinero, incumplimiento legal, o acceso no autorizado explotable hoy |
| 🟠 Grave | 24 | Funcionalidad rota, control declarado que no existe, o riesgo material |
| 🟡 Medio | 38 | Defecto de lógica con impacto acotado |
| ⚪ Menor | 27 | Inconsistencia, código muerto, deuda estructural |

**Los cinco de mayor riesgo, por orden:**

1. **El cliente puede escribir cualquier columna de sus propias órdenes**, incluido `status` y `total_paid` (§2.1). Es la llave maestra de casi todo lo demás.
2. **`POST /api/orders/[orderId]/cancel` no requiere autenticación alguna** y opera con clave de servicio sobre Stripe (§2.2).
3. **La nómina paga las vacaciones al 4% de lo debido en el finiquito** y un día de enfermedad a $2.00 en vez de $200 (§2.3, D-P0-1/D-P0-4).
4. **Dos caminos verificados de doble cobro real al cliente** (B-P0-1, B-P0-5).
5. **Cada lunes toda la plantilla queda marcada `suspended`**, colapsando el sistema de confianza semanal completo (D-P0-6).

---

## 2. Los tres fallos de raíz

Estos tres se re-verificaron a mano. Explican, solos o combinados, la mayor parte del resto del informe.

### 2.1 🔴 RAÍZ-1 — El comprador tiene permiso de escritura sobre toda la fila de su orden

`supabase/migrations/019_modulo1_rls_insert_update_quotes_orders.sql:31-34`:
```sql
DROP POLICY IF EXISTS "Users update own orders" ON orders;
CREATE POLICY "Users update own orders" ON orders
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

Verificado por el consolidador:
- Ninguna migración posterior la elimina ni la reemplaza (el único `DROP POLICY` de ese nombre es el de la propia 019, que precede a su `CREATE`).
- **No existe ningún `GRANT`/`REVOKE UPDATE` por columna sobre `orders`** en las 166 migraciones.
- **No existe ningún trigger `BEFORE UPDATE ON orders`** que restrinja qué columnas puede tocar el cliente.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` es pública por diseño (va en el bundle del navegador).
- `src/lib/client-visible-columns.ts:16-19` lo admite por escrito: el blindaje por columna *"es a nivel de base de datos (GRANT por columna) … pendiente"*.

**Qué pasa en la práctica.** Desde la consola del navegador, con su propia sesión:
```js
await supabase.from('orders').update({ status: 'completed' }).eq('id', miOrden)
```
Y con eso el cliente desbloquea, sin haber recibido ningún servicio:

| Consecuencia | Evidencia |
|---|---|
| Se dispara el trigger que crea la `qc_review` | `016_modulo7_qc_auto_trigger.sql:53-58` (`AFTER UPDATE ON orders`) |
| Puede abrir un reclamo de garantía | `client/warranty-claims/route.ts:114-119` exige exactamente `status === 'completed'` |
| El cron paga $30 al referente y $30 al referido | `cron/referral-credit-grant/route.ts:63-71` |
| Entra en el barrido de encuesta pre-reseña ($10 de billetera) | `cron/pre-review-survey`, y ver §2.1-bis |
| Entra en NPS, churn, galería, rebook | `rebook/route.ts:55-60` y crons homónimos |
| También puede escribir `total_paid` y `wallet_amount_used` directamente | mismas políticas, sin restricción de columna |

Y al revés: puede sacar una orden de `cancelled` para revivirla.

**§2.1-bis — el corolario que ya paga dinero sin ayuda de nada más.** Toda orden nace con un `pre_review_survey_token` (`migrations/156_e5_pre_review_survey.sql:16`, `DEFAULT gen_random_uuid()`), el cliente lo puede **leer** con la anon key (política `"Clients read own orders"`, `008_modulo5_rls_orders_quotes.sql:14-15`, sin restricción de columna), y el endpoint que lo canjea **no comprueba el estado de la orden ni si la encuesta fue enviada** — `src/app/api/client/pre-review-survey/route.ts:56-64`. Acto seguido, líneas 115-133, acredita **+1000 centavos** vía `apply_wallet_delta`.

Es decir: reservar 20 servicios, leer los 20 tokens, canjear los 20, cobrar **$200 de billetera**, y cancelar las 20 órdenes. El `UNIQUE(order_id)` de `pre_review_surveys` solo impide repetir la misma orden, no impide una encuesta por orden nunca prestada.

---

### 2.2 🔴 RAÍZ-2 — Cancelar una orden ajena no requiere estar autenticado

`src/app/api/orders/[orderId]/cancel/route.ts:50-84`, verificado literal:
```ts
const supabase = createClient(supabaseUrl, supabaseServiceKey);   // ← clave de servicio: RLS desactivada
const authHeader = request.headers.get("authorization");
let userId: string | null = null;

if (authHeader?.startsWith("Bearer ")) {          // ← if sin else
  const token = authHeader.replace("Bearer ", "");
  if (token === process.env.CRON_SECRET) {
    userId = null;
  } else {
    const { data } = await supabase.auth.getUser(token);
    userId = data.user?.id ?? null;               // ← token inválido ⇒ null
  }
}
...
if (userId && order.user_id !== userId) {          // ← userId null ⇒ comprobación saltada
  return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
}
```

El bloque de autenticación es un `if` sin `else`. **Sin header `Authorization`, `userId` queda `null` y la comprobación de propiedad de la línea 82 no se ejecuta.** Idéntico resultado con un `Bearer` basura.

**Qué pasa en la práctica.** `POST /api/orders/<uuid>/cancel` sin credenciales, con clave de servicio:
- La orden pasa a `cancelled` (línea 187).
- A menos de 24h del servicio, se **captura el 100% del hold en la tarjeta de un cliente ajeno** (`stripe.paymentIntents.capture`, línea 132).
- A más de 72h, se libera el hold → cancelación gratuita masiva de la agenda.
- Se cancelan las `assignments` del equipo (línea 208) y se libera el `capacity_slot` (línea 281).

El `orderId` es un UUID, lo que impide la enumeración ciega. Pero ese UUID aparece en las respuestas de `/api/client/orders`, galería y tracking, y lo conoce cualquier cliente, cualquier empleado del panel, y cualquier log. **La única barrera real es el secreto de un identificador que el propio sistema publica.**

**Agravante estructural** (Agente C, H-11): `src/middleware.ts:64-66` excluye `api` del matcher. No hay ninguna comprobación centralizada de autenticación para las 232 rutas de API. Cada `route.ts` se defiende sola, y esta se defendió mal.

**Corolario de gobierno** (Agente A, #21): no existe ningún endpoint administrativo para cancelar una orden. `Glob src/app/api/admin/orders/**` devuelve solo `force-full-capture` y `communication-log`. El operador legítimo no tiene vía con RBAC; el ilegítimo no necesita ninguna.

---

### 2.3 🔴 RAÍZ-3 — Confusión de unidades monetarias en todo el sistema

Coinciden los agentes B y D, desde dominios distintos y sin verse. **Conviven tres sistemas de unidades**, y la mezcla produce errores de factor 100 en producción.

**Inventario de unidades** (`supabase/migrations/001_modulo1_base_schema.sql`, `021_modulo2_payroll.sql`, `025_modulo2_wallet.sql`, `003_modulo3_employee_tables.sql`):

| Familia | Unidad | Ejemplos |
|---|---|---|
| `quotes.total`, `gst`, `pst` | dólares con centavos (`NUMERIC(10,2)`) | 001:125-127 |
| `orders.total_paid`, `hold_amount`, `wallet_amount_used`, `card_amount_charged` | **dólares enteros (`INTEGER`)** | 001:82, 025:63-66 |
| `client_wallets.balance`, `payroll_entries.gross_amount`, `*_cents` | **centavos (`INTEGER`)** | 025:9, 021:39 |
| `employees.day_rate`, `payroll_entries.day_rate` | **dólares** | 003:14 |

**Consecuencias verificadas:**

- **Se cobra distinto de lo cotizado.** `cron/batch-capture/route.ts:225` hace `Math.round(Number(quotes.total))` sobre un total con centavos. Cotización de **$372.96** con precio congelado → se cobra **$373.00**. Sobrecobro de $0.04 sobre un precio legalmente sellado; con $372.49 sería subcobro de $0.49.
- **La billetera se descuadra en cada uso.** `client/wallet/apply/route.ts:127-130` escribe `applyDollars = applyCents / 100` en `wallet_amount_used`, que es `INTEGER`. Crédito de 3050 centavos → la RPC debita 3050 correctamente, pero la orden guarda **31**. El negocio regala $0.50 y los dos registros quedan descuadrados de forma permanente y no detectable: nada los concilia.
- **Un día de enfermedad se paga a $2.00.** `empleado/sick-leave/route.ts:105-106` pasa `employee.day_rate` (dólares) a `calculatePayroll({ dayRate })`, cuya firma declara `// cents CAD` (`payroll.ts:18`). Empleado de $200/día → `paid_amount_cents = 200` → el CSV de nómina emite **$2.00**. Cinco días de ley = **$10.00 en vez de $1,000.00**. Agravante: se lee `.baseAmount` y no `.grossAmount`, con lo que además se salta el ajuste al piso salarial de BC.
- **Stripe rechaza capturas enteras.** `batch-capture/route.ts:511` calcula `amount: balanceAmount * 100` sobre un float. Con `quoteTotal = 324.99`, JS da `32498.999999999996`; Stripe exige entero → falla la captura completa de esa orden, `capture_attempts++`, y a los 3 intentos escala a ticket. La orden nunca se cobra.

---

## 3. Hallazgos por dominio

Nomenclatura: **A**=ciclo de orden, **B**=dinero, **C**=RBAC, **D**=empleado/nómina, **E**=compras y cliente.

### 3.1 🔴 Críticos (11)

| ID | Hallazgo | Evidencia |
|---|---|---|
| **RAÍZ-1** | Cliente escribe cualquier columna de su orden | `019:31-34` |
| **RAÍZ-1b** | Autoconcesión de $10 por orden vía token de encuesta | `client/pre-review-survey/route.ts:56-64` |
| **RAÍZ-2** | Cancelación de órdenes sin autenticación + clave de servicio | `orders/[orderId]/cancel/route.ts:58-84` |
| **A-1** | `t_in` sin validar estado previo: orden completada se re-completa N veces | `empleado/servicio/route.ts:330-342` |
| **A-2** | Ningún evento de servicio comprueba `orders.status`: se completa una orden cancelada y se le cobra el total sobre la penalidad | `empleado/servicio/route.ts:317-328, 398` |
| **A-3** | `force-full-capture` no mira `orders.status`: cobra el total de órdenes canceladas | `admin/orders/[id]/force-full-capture/route.ts:45-69` |
| **B-P0-1** | `force-full-capture` no resetea `capture_attempts` → el retry de las 22:00 vuelve a cobrar. **Doble cobro real** | `force-full-capture:190-202` + `batch-capture-retry:145-155` |
| **B-P0-5** | El retry ignora la billetera y no escribe ledger ni QBO. Cliente paga $403 por un servicio de $373 | `batch-capture-retry:189, 329-383` |
| **D-P0-2** | RLS `FOR ALL` sobre `sick_leave_requests`: el empleado se autoasigna `paid_amount_cents` sin techo | `170_e3_sick_leave.sql:37-41` |
| **D-P0-3** | Crédito de Day Rate por "no estoy listo": sin unicidad diaria, auto-insertable por RLS. $2,000 por un día no trabajado | `049:73-89`, `090:60-64` |
| **D-P0-4** | `payroll_ytd` se sobrescribe en vez de acumular → finiquito de vacaciones al 4% de lo debido ($72 en vez de $1,872) | `payroll-export/route.ts:331-345`, `offboard:76-83` |
| **E-A2** | El stock nunca se decrementa ni se repone: todo el motor de reposición corre sobre un número congelado | `admin/inventory-items/route.ts` (solo GET/POST) |

### 3.2 🟠 Graves (24)

**Dinero**

- **B-P0-3** — **Cero claves de idempotencia de Stripe en todo el repo.** Búsqueda de `idempotencyKey` en `src/`: 3 coincidencias, todas en el ledger interno. Ninguna de las 12 llamadas a `create`/`capture` la usa. Caso más nítido: `capture-remainder/route.ts:120-176` cobra en la línea 120 y marca en la 170; un crash intermedio hace que la hora siguiente **cobre otra vez**.
- **B-P0-2** — `dispatch_runs` no tiene `UNIQUE(run_date, phase)`. El guard anti-doble-ejecución de `batch-capture` es un read-then-insert decorativo. Dos invocaciones concurrentes procesan el mismo lote.
- **B-P3-1** — **El panel de contabilidad reporta $0 de ingresos con la configuración por defecto.** `admin/accounting/route.ts:60,77-80` deriva "cobrado" de `chargeback_reserves`, que solo se puebla si el flag `chargeback_reserve_enabled` está encendido (apagado por defecto). Además `employerBurdenCents: 0` está hardcodeado (línea 108).
- **B-P3-2** — La alerta de divergencia QBO **se dispara todos los días sin excepción**: la comparación suma líneas `capture` y `sales_receipt` de la misma orden sin filtrar por tipo (`qbo-sync/route.ts:270-279`), duplicando el importe. Control de conciliación muerto por ruido.
- **B-P1-3** — La reserva de impuestos aplica 12% sobre un total que **ya incluye** el 12%. Debería ser `T × (0.12/1.12) = 10.714%`. Sobre-reserva de $4.32 por orden.
- **B-P1-4** — `wallet.ts:58-63` asume montos positivos; la RPC guarda débitos en negativo (`180:58-59`). `toConsume` sale negativo → el bucle rompe en la primera iteración → **ningún lote de crédito se marca como gastado**, y el cliente puede quedar con saldo visible pero disponible $0.
- **B-P2-1** — `charge.refunded` resta un acumulado, no un delta (`webhook/route.ts:302-303`). Dos reembolsos parciales de $100 y $50 dejan `total_paid` en $150 en vez de $250.
- **B-P2-2** — **Ningún reembolso revierte el ledger, ni comisiones de partner, ni créditos de referido.** El tipo `warranty_refund` existe en `shadow-ledger.ts:41` y **ninguna ruta lo inserta jamás**. Un chargeback ganado por el cliente deja $120 en créditos y comisiones ya pagados que nadie reclama.
- **B-P2-3** — `cron/paypal-refunds` **no reembolsa nada, para siempre, en silencio** (`route.ts:61-74`: `TODO` + `console.log`). Reescribe `"failed"` a `"pending"`, borrando la evidencia de fallos. Sin alerta ni ticket.
- **B-P2-4** — El webhook descarta el error del INSERT de deduplicación (`webhook/route.ts:56-69`) y continúa al `switch` aunque el evento ya estuviera procesado.
- **B-P3-4/P3-5** — La reconciliación de holds no escribe `total_paid` ni ledger; el retry tampoco. Ingreso real, invisible para los tres sistemas contables.
- **B-P5-1** — `admin/partner-commissions` **confía el importe base al body** sin compararlo con la orden, y no tiene unicidad por `(partner_id, order_id)`. Comisión de $149,999.98 sobre una orden de $373, duplicable.

**Ciclo de orden**

- **A-6** — **El muestreo anti-gaming del 10% nunca se ejecuta.** El trigger de BD escribe `sampling_reason = 'Elite auto-approval'` (`016:45`) y gana siempre la carrera contra la ruta, que escribiría `'elite_auto_approval_sample'` (`admin/qc/route.ts:92`) pero choca con `UNIQUE(order_id)` (`010:115`). Las líneas 191-262 de `admin/qc/[orderId]/review` — detección de manipulación, revocación de auto-aprobación, suspensión — son **código inalcanzable**. Ver §5.1.
- **A-7** — **Captura de pago sin QC aprobado es el comportamiento por defecto**: el muro está tras el flag `batch_capture_qc_gate_enabled`, apagado (`batch-capture:166-182, 273`).
- **A-8** — `admin/qc/[orderId]/review` no lee el estado previo (`:53-57`): una review `approved` y ya cobrada puede volverse `rejected` o `rework` días después. La ruta simétrica del empleado sí valida (`resubmit:76-78`) — la asimetría prueba que es omisión.
- **A-9** — `POST /admin/dispatch` hace `.delete()` **físico** de `assignments` sin filtro de estado (`:148-151`), pese a que existe `deleted_at` universal. Si un empleado está `in_progress`, su fila desaparece y no puede cerrar: la orden queda colgada. No cubre `no_show` en su guarda (`:48-53`).
- **A-10** — `ensureZoneAssignment` reparte zonas a empleados cancelados y zonas add-on no vendidas (`zone-assignment.ts:88-93, 113-122`), mientras el consumidor filtra ambas (`servicio:94-100`). Resultado: `t_out` **bloqueado permanentemente** y la orden nunca se cobra. El plan es idempotente: calculado mal una vez, no se recalcula.
- **A-11** — Tres fuentes distintas para el subtipo de servicio (dos derivadas, una la columna real). El empleado rellena un checklist que el cierre no mira. Además el `serviceSubtype` llega como query param del cliente sin validar (`empleado/checklist/route.ts:37,66`).
- **A-5** — La rama de recuperación de no-show es código muerto: el filtro `.eq("status","confirmed")` (`:168-174`) excluye las órdenes que ya pasaron a `no_show`. `recovered` es inalcanzable.
- **A-4** — `cron/capture-remainder` es el **único** cron de dinero sin filtro de estado ni de borrado lógico (`:70-78`). Cobra el remanente de órdenes canceladas dentro de la ventana de 24h.

**RBAC**

- **C-H2** — `qc_only` — el rol de menor privilegio — puede **publicar fotos de la casa de un cliente en el sitio público**, porque `live-portfolio` reutiliza el recurso `qc_wall` (`admin-rbac.ts:72`). Hoy la cadena está cortada por una pieza que falta (`anonymization_status`), no por un control.
- **C-H3** — **Siete políticas RLS confunden autenticación con autorización** (`WITH CHECK (auth.uid() IS NOT NULL)`): `key_handling_log`, `towel_cycle_log`, `safety_aborts`, `near_misses`, `workplace_incidents`, `neighbor_complaints`, `neighbor_leads`. Un **cliente** recién registrado puede, con la anon key, inyectar un registro de custodia de llaves falso e **inborrable** (`trg_prevent_delete`), o un incidente WorkSafeBC ficticio.
- **C-H7** — `ops_coordinator` y `qc_only` **no existen para la base de datos**: ninguna de las 343 políticas los menciona. Toda política administrativa usa `is_supervisor()`, que mira `employees.role`, no `admin_roles`. La matriz RBAC es una capa de API, no un control de base de datos — y hay 10 endpoints administrativos con clave de servicio donde es la única barrera.

**Empleado / nómina**

- **D-P0-5** — **`GET /api/admin/payroll-export` tiene efectos de escritura y no es idempotente.** Cada recarga del navegador infla `payroll_ytd` (`:312-346`). Tres recargas de un ciclo de $1,800 → YTD de $5,400. Con el YTD inflado por encima del YMPE, **CPP y EI dejan de deducirse el resto del año** y queda una deuda de remesas frente a CRA. Y `format=json` es el valor por defecto: basta abrir la página.
- **D-P0-6** — **Cada lunes toda la plantilla pasa a `trust_level = 'suspended'`.** `cron/weekly-scores/route.ts:61-68` dice calcular "el lunes de esta semana" pero solo toma la fecha de hoy; corre a la 01:00 del lunes, sobre una ventana en la que nadie ha trabajado. El RPC devuelve telemetría 0 y peer neutro → total 40 → `'suspended'` incluso con auditorías perfectas (`192:209-214`). Destruye la auto-aprobación QC, el ranking de despacho y `chemicalBackupRank`.
- **D-P0-7** — Incoherencia de escala en el peer score (0-20 tratado como 0-100) que además se ejecuta **siempre**, dejando `total_score` y `trust_level` **contradictorios en la misma fila**. Efecto colateral: la causal "score <50 por 3 semanas" es inalcanzable por construcción.
- **D-P0-8** — La detección de colusión entre pares consulta la semana equivocada → `weekVotes` siempre vacío → `peer_vote_collusion_flags` **nunca recibe una fila**. Dos empleados pueden votarse 5/5 indefinidamente.
- **D-P1-2** — **Nadie cobra nunca un feriado estatutario.** `statutory-holiday-scan/route.ts:65-71` usa un embed `orders(service_date)` **sin `!inner`**, que en PostgREST no filtra la fila padre → `daysWorkedInPrior30 = 0` para todos → `eligible: false`. El repo usa el patrón correcto (`orders!inner`) en `evaluate-badges:66`, lo que confirma el descuido. Doble candado: aunque se arreglara, `average_day_pay_cents` sale de `payroll_entries`, que está vacía.
- **D-P1-1** — La jornada **no tiene máquina de estados**: doble inicio, cierre sin apertura, cierre antes del inicio, jornada abierta indefinidamente (`empleado/jornada/route.ts:31-131`, sin ninguna consulta al último evento). El cron de descanso semanal sobrescribe el `start` anterior en silencio y produce turnos con `end < start` → `gapHours` negativo.
- **D-P1-8** — El alta de empleados permite un Day Rate **por debajo del salario mínimo legal**: la única validación es `> 0` (`admin/empleados/route.ts:98-100`). `dayRate = 50` = $6.25/h contra un piso de $18.25.

**Compras y cliente**

- **E-A1** — La máquina de estados de purchase orders **termina en `approved`**. `ordered`, `received` y `cancelled` existen en el CHECK y **ningún código los escribe**; `ordered_at`/`received_at` tampoco. No se puede registrar la recepción de mercancía de ninguna OC.
- **E-B3** — **Los contratos recurrentes no existen.** `service_contracts` no tiene ni un `.insert()` en todo el repo (9 ficheros, todos lectura o update). `next_scheduled_date` se lee y **nunca se escribe**. El ajuste IPC anual modifica y comunica al cliente un precio que el sistema nunca aplica, porque la visita se re-cotiza desde cero. Además el "IPC" se deriva del delta del salario mínimo en `payroll_settings`, y el preaviso de 30 días se pierde para siempre si ese día concreto el cron no corre.
- **E-B4** — Las garantías **no tienen plazo**: no existe ninguna constante de ventana de reclamación en el repo. Se puede reclamar sobre un servicio de hace tres años, o sobre una orden ya reembolsada (nada consulta el estado de pago). Un reclamo `open` sin resolver bloquea **para siempre** la purga de fotos del interior del domicilio.
- **E-B5** — **PIPEDA es cumplimiento aparente.** El derecho de acceso es un campo de texto libre donde el admin anota dónde dejó el archivo (`pipeda/requests/route.ts:16-18`, admitido por escrito). El de borrado hace `deleted_at` en **una sola tabla** (`client_profiles`), dejando intactos `orders`, `quotes` (con `consent_ip`), `profiles`, `client_properties`, `communication_log`, `wallet_transactions`, `entity_notes` y las fotos en Storage. `purge_eligible_at` se escribe y **ningún job lo consume**. Y el titular **no tiene canal para ejercer su derecho**: solo un admin con rol `compliance` puede crear la solicitud.

### 3.3 🟡 Medios (selección de los 38)

- **C-H6 — Segregación de funciones ausente en cuatro flujos.** Órdenes de compra: crear y aprobar comparten el recurso `inventory`, y `purchase_orders` **ni siquiera tiene columna `created_by`**, lo que impide la detección posterior. Upsells: la ruta de aprobación nunca lee `employee_id`, así que un supervisor con `ops_coordinator` puede proponerse y aprobarse un upsell por encima del tope, cobrando comisión — exactamente lo que el comentario del archivo dice impedir. Disputas de horas: `resolved_by` nunca se compara con `ticket.employee_id`. Cotizaciones: mismo patrón.
- **C-H5 — El recurso `finance` es un cajón de sastre de 25 endpoints no financieros** (SEO, experimentos A/B, migración legacy, escenarios de estrés, métricas de crecimiento). Decisión de producto pendiente: **crear el rol "Finanzas" que el negocio pide entregaría de paso todo eso**.
- **C-H8** — `GET /api/admin/access-recovery` usa el cliente anon contra una tabla con RLS `false/false` → devuelve **siempre vacío, sin error**. El dueño nunca ve las solicitudes pendientes, y la única vía que funciona (`co-verify`) emite el código de emergencia **sin su intervención**.
- **C-H9** — El contador de intentos de co-verificación **se reinicia a 0 en cada `request`** (`co-verify:106-113`), y el rate-limit se apoya en `X-Forwarded-For`, cabecera controlada por el cliente. Fuerza bruta sin techo sobre un código corto cuyo premio es acceso `owner_admin`.
- **C-H10** — `anon` conserva `SELECT` sobre todas las tablas presentes y futuras de `public` (`125:22`; la 129 revocó solo escritura). Hoy contenido por RLS, pero el propio comentario de la 129 reconoce que "ya pasó dos veces" que se olvidara `ENABLE ROW LEVEL SECURITY`.
- **C-H4** — `/api/empleado/llaves` no verifica asignación. El GET (que pide `lockbox_code`) está salvado **por accidente**, por una política RLS de supervisores; el POST sí es explotable hoy. Si esa ruta se migrara al patrón service-role que ya usan 10 rutas admin, se convierte en fuga de códigos de acceso físico a viviendas.
- **D-P1-3** — Los bonos de bienestar no se pagan **ni se llegan a registrar**: `employee_wellbeing_bonuses` no tiene política de INSERT para empleados (`188:96-108`), el insert cae en un `catch` no bloqueante, y la tabla tampoco aparece en la nómina. La UI promete "+$5 por 5 días de racha".
- **D-P1-4** — Resolver una disputa de horas a favor del empleado **no cambia un centavo**: corrige `service_logs`, y ningún cálculo de nómina lee `service_logs` (el pago es por `day_rate`).
- **D-P1-5** — El SLA de 24h de las disputas de horas: `sla_due_at` tiene **una sola aparición en todo `src/`**, la línea que lo escribe. Y **no existe endpoint de listado** — el admin solo puede resolver una disputa si el empleado le pasa el UUID por otro canal.
- **D-P1-6** — Los votos del domingo caen en la semana siguiente (`getDay() === 0` mal manejado, `votacion:50-54`), permitiendo hasta 3 votos al mismo compañero en 8 días. El repo tiene la implementación correcta tres archivos más allá (`ritual/inicio:27-33`).
- **D-P1-7** — Un empleado puede registrar una **lesión laboral a nombre de cualquier compañero, con cualquier fecha** (`workplace-incident:76-95`): `employeeId` viene crudo del body y `incidentDatetime` acepta 1990 o 2050, generando un deadline WorkSafeBC ya vencido.
- **D-P1-9** — El límite de descanso semanal es puramente observacional: inserta en una tabla y nada más. Un empleado con un solo turno de 60 horas continuas se declara **conforme** (`shift-rest.ts:44-47`), y uno con la jornada sin cerrar **ni se evalúa**.
- **A-12/A-13** — Rechazar una cotización ya `reserved` la marca `expired` sin mirar el estado; y recotizar tras cancelar rompe contra `UNIQUE(quote_id)` **después de haber verificado el anticipo PayPal** → anticipo cobrado, orden inexistente, y `cron/paypal-refunds` no lo recoge porque busca órdenes `cancelled` que en ese caso no existen.
- **A-14** — Doble `t_out` simultáneo del equipo → dos ejecuciones de `sendClosureCommunications`: dos emails de galería y **dos solicitudes de reseña** al cliente.
- **A-15** — El no-show por causa "empleado" depende de un `jornada_start` que **nada obliga a registrar**. Un empleado que no pulsó "iniciar" convierte todo no-show real de cliente en `cause='employee'` → no se notifica, no se cobra penalidad, y **la orden queda en `confirmed` para siempre**, fuera de `batch-capture` y de reconciliación. Fuga de ingresos silenciosa.
- **E-A3** — La aprobación de OC no tiene compare-and-swap (lectura y escritura desacopladas → doble aprobación por carrera), no filtra borrados lógicos, y **no tiene ningún límite de monto por rol**: una OC de $50,000 se aprueba con el mismo clic que una de $12. El patrón correcto existe en el repo (`warranty-claims/[id]/resolve:116`).
- **E-A4** — Upsells: `client_approved` es **escritura muerta** (leída en dos sitios, escrita en ninguno) → la pantalla de cierre de jornada siempre muestra $0 de comisión. Y el tope del 50% se evade con `baseValue = 0` cuando el quote no se encuentra, error que ni se inspecciona.
- **E-B6** — **Auto-unsubscribe masivo:** la baja automática se dispara con 5 mensajes que no llegaron a `'read'`, y **nadie escribe `'read'` jamás** (no hay webhook de proveedor ni pixel). La lista de marketing se vacía sola. El "último intento" que exige el plan no está implementado.
- **E-B9** — `wallet/apply` documenta un chequeo de `status` que el código no hace: el cliente puede quemar su crédito en una orden `cancelled` que nunca se cobrará, sin vía de reversión.
- **E-B7** — La ventana de reseña de "24h" es en realidad de 24 a 48h por un error de zona horaria, con `-07:00` hardcodeado y un comentario que dice "PST" donde el valor es PDT.
- **E-A8** — `phone-booking` usa `.ilike()` con el email del cliente **como patrón SQL** (`:255-259`): un email con `%` o `_` engancha la cotización a la cuenta de otro cliente.
- **E-A6/A7/A9/A10** — Multas con conductor no verificado y `status` congelado en `unpaid`; regalos de retención cuya elegibilidad la teclea el admin (`ltvCents: 99999999` ⇒ auto-aprobado) y sin control de unicidad; proveedores que no se pueden dar de baja; catálogo de precios que puede quedar sin ningún precio vigente por falta de transacción.

### 3.4 ⚪ Menores (selección de los 27)

Estados fantasma que el CHECK permite y nada escribe (`orders.pending`, `assignments.en_route` —leído en 5 sitios, escrito en ninguno—, `no_show_logs.cancelled`, los 5 estados de `contract_instances`, tabla sin un solo consumidor). `cancel` y `no-show` sobrescriben `hold_captured_at` con NULL, borrando la fecha de una captura real. Zonas con `items: []` pasan el protocolo de cierre sin foto. `promotion_ready` es matemáticamente inalcanzable. `service_gold` resta reclamos de compañeros y puede dar negativo. Construcción manual y frágil del timestamp de jornada dependiente del formato exacto de ICU. Corte del ciclo de nómina con fechas desnudas contra `TIMESTAMPTZ`. Tres fuentes de nómina sin filtro de borrado lógico, en el mismo archivo donde las otras cuatro sí lo tienen. `entity_notes` DELETE sin comprobación de pertenencia. `partners` expone identificadores fiscales en claro a todo el rol `finance`. `Math.random()` en la generación de códigos de referido. `birth_date` editable por el cliente en cualquier momento. Reservas de equipo irrevocables y sin validar que el ítem sea equipo.

**Además, 14 valores de negocio hardcodeados** que deberían venir de `economic-params`/`pricing-settings` y no vienen: comisiones de partner (10%/5%/$20/15%), crédito de referido ($30), bono de líder ($5), comisión de Stripe (2.9%+$0.30, **duplicada en dos módulos**), GST/PST (**declarados en dos archivos independientes** — `pricing.ts:6-7` y `cash-reserve.ts:10-11`), hold del 40%, anticipo PayPal del 50%, salario mínimo BC (en `pricing.ts`, irónicamente, existiendo `economic-params.ts` para eso).

---

## 4. Interdependencias — cadenas compuestas

El valor de haber auditado en paralelo está aquí: **ninguno de estos cinco encadenamientos es visible desde un solo dominio.**

### Cadena 1 — De permiso de escritura a dinero, en tres saltos

```
RAÍZ-1 (cliente escribe orders.status)
  → status='completed'
  → cron/referral-credit-grant paga $30+$30           [E]
  → cron/pre-review-survey habilita el token de $10    [E]
  → client/warranty-claims acepta el reclamo           [E]
  → trigger crea qc_review                             [A]
  → y B-P2-2: nada de eso se revierte si hay chargeback [B]
```
Un cliente puede extraer $70 por orden reservada y nunca prestada, y el sistema no tiene camino de reverso para ninguno de los tres importes.

### Cadena 2 — La orden zombi que nadie cobra

```
D-P1-1 (jornada sin máquina de estados: nada obliga a jornada_start)
  → A-15 (no-show clasificado como cause='employee')
  → no se notifica, no se cobra penalidad
  → la orden se queda en 'confirmed' para siempre
  → B: batch-capture solo barre status='completed' del día
  → ingreso perdido, sin alerta, sin registro
```
Y en paralelo, **A-10** produce el mismo resultado por otra vía: `t_out` bloqueado permanentemente por un reparto de zonas mal calculado e idempotente.

### Cadena 3 — Contabilidad que reporta cero

```
D: payroll_entries NUNCA se puebla (ninguna ruta inserta)
  → admin/accounting suma costo laboral desde ahí → $0 de mano de obra
  → B-P3-1: y los ingresos vienen de chargeback_reserves, apagado por defecto → $0
  → resultado: el panel muestra ingresos $0 y costo laboral $0
  → B-P3-2: la única alerta que podría detectarlo se dispara todos los días y nadie la mira
  → y batch-capture-partial calcula la exposición como Σ gross_amount → 0: no protege nada
```
**Las decisiones de negocio se están tomando sobre un panel cuyos dos sumandos principales son cero por razones distintas e independientes.**

### Cadena 4 — El sistema de confianza que se apaga solo

```
D-P0-6 (toda la plantilla 'suspended' cada lunes)
  → nadie es 'elite' nunca
  → A-6 (el muestreo del 10% es inalcanzable por la carrera trigger/ruta)
  → doblemente muerto: por origen y por destino
  → dispatch-team.ts rankea sobre un trust_level constante
  → chemicalBackupRank devuelve 0 para todos
  → D-P0-7: y total_score contradice a trust_level en la misma fila
```
Dos defectos independientes, en dominios distintos, matan el mismo control. **Arreglar uno solo no lo resucita.**

### Cadena 5 — Auto-servicio de nómina

```
C-H3/C-H7 (RLS FOR ALL sobre tablas del dominio empleado)
  → D-P0-2: el empleado escribe su propio paid_amount_cents
  → D-P0-3: y sus propios payroll_readiness_credits, sin límite diario
  → D-P0-5: y el admin, al abrir el panel, infla el YTD que rige CPP/EI
  → D-P0-4: y el finiquito lee un ytd_vacation_pay que se sobrescribe
  → C-H6: y no hay segregación de funciones que lo detecte después
```

### Dependencias sueltas relevantes

- **A→B:** `batch-capture` solo procesa órdenes `completed` **con `service_date` = hoy**. Una orden cerrada al día siguiente (cierre tardío, servicio nocturno, corrección) **no vuelve a calificar en ningún cron**. No hay barrido de rezagados.
- **A→B:** el guard de `dispatch_runs` implica que si el cron muere a mitad del lote, **las órdenes restantes nunca se cobran**.
- **C→todos:** los 10 endpoints admin con clave de servicio dependen solo del chequeo TypeScript, porque **la matriz RBAC no existe a nivel de base de datos** (C-H7).
- **D→B:** la unidad de `payroll_entries.gross_amount` es **centavos** (confirmado desde cuatro fuentes independientes). Era la incógnita bloqueante que B declaró; queda resuelta. El problema no es la unidad, es que la tabla está vacía.
- **E→D:** `employee_referral_bonuses` se funde a nómina sin validar que el empleado nominado exista, esté activo o sea líder.

---

## 5. Contradicciones entre auditores, resueltas

Dos informes se contradijeron. Ambas se resolvieron abriendo el código, no promediando.

### 5.1 ¿El anti-gaming funciona? — **No.** Gana el Agente A.

- **Agente A (#6):** el muestreo del 10% es inalcanzable porque el trigger de BD gana la carrera y escribe otro literal.
- **Agente D (descartado #13):** *"`anti-gaming.ts` no es código muerto; sí está cableado y funciona."*

**Verificado por el consolidador.** Ambos tienen razón sobre hechos distintos, y la conclusión de D es la equivocada:
- `016_modulo7_qc_auto_trigger.sql:45` — el trigger escribe `sampling_reason = 'Elite auto-approval'` con `ON CONFLICT (order_id) DO NOTHING`.
- `admin/qc/route.ts:92` — la ruta escribiría `'elite_auto_approval_sample'`.
- `010_modulo7_qc_score_tables.sql:115` — `UNIQUE(order_id)`.
- El trigger es `AFTER UPDATE ON orders WHEN (OLD.status IS DISTINCT FROM NEW.status)`, luego se dispara **dentro de la misma transacción** que pone la orden en `completed`. Siempre llega primero.

D verificó que las funciones están **importadas y llamadas** (cierto). A verificó que la condición que las activa **nunca se cumple** (también cierto, y es lo que decide). `sampling_reason` en producción vale `'Elite auto-approval'` o `NULL`, jamás el literal que buscan las líneas 191-262. **El control es inalcanzable.** Y por D-P0-6, tampoco habría nunca un `elite` que muestrear.

### 5.2 ¿`cancel` requiere autenticación? — Ambos aciertan; C es más grave y correcto.

- **Agente A (#21):** bypass de propiedad vía `CRON_SECRET`.
- **Agente C (H-1):** bypass **sin ninguna credencial**, por un `if` sin `else`.

Verificado: C es correcto y estrictamente más fuerte. A describió un subcaso. Se reporta la versión de C (§2.2).

### 5.3 Coincidencias no contradictorias que refuerzan

Tres hallazgos fueron alcanzados por dos agentes desde dominios distintos sin verse: la confusión de unidades (B y D), la ausencia de segregación de funciones en compras (C y E), y la muerte del sistema de confianza semanal (A por el lado QC, D por el lado del cron). **La coincidencia independiente es la evidencia más fuerte de este informe.**

---

## 6. Descartados tras verificar

Se reportan porque muestran qué se comprobó, no solo qué falló. Y porque **en varios casos el patrón correcto existe en el repo**, lo que convierte a las omisiones en descuidos identificables.

**Lo que está bien hecho:**

- `apply_wallet_delta` (`180:44-56`) usa `SELECT ... FOR UPDATE` real y `RAISE EXCEPTION` si el saldo quedaría negativo, más `CHECK (balance >= 0)`. **No hay race a nivel de RPC** — el problema está una capa arriba.
- `admin/warranty-claims/[id]/resolve:116` es el **único compare-and-swap correcto del repo** (`.in("status", [...])` en el propio UPDATE + 409). Es el patrón que `purchase-orders/approve` y `admin/qc/review` deberían haber copiado.
- `client/contracts/[contractId]/status:87-104` valida terminalidad y cada transición por separado. Es el mejor ejemplo de máquina de estados del repositorio.
- **Ningún IDOR en `/api/client/*`**: se verificaron una a una las 9 rutas que reciben identificador. Todas filtran por propietario, todas devuelven 404 en vez de 403, y todas usan el cliente anon para que RLS actúe como segunda barrera. Es exactamente lo que `cancel` no hace.
- **Los 44 crons verifican `CRON_SECRET`.** Ninguna excepción.
- **Los 232 handlers de `/api/admin/` invocan `requireAdminRole`.** Ninguna excepción. `backup-codes/verify` es la única ruta sin él, correctamente (es la entrada cuando no hay sesión) y su lógica de consumo atómico es sólida.
- Tokens (`review`, `nps`, `pre_review`) son UUID v4 únicos, no adivinables, y los tres son de un solo uso con verificación de propiedad además del token.
- El unsubscribe sin login usa una RPC acotada que requiere el UUID: **no basta con el email**.
- El gate CASL consulta `marketing_opt_in` antes de despachar y el `{unsubscribe_link}` se inyecta de oficio.
- Auto-referido bloqueado por identidad y por IP; el crédito exige orden `completed` posterior al referral; ban por 3 códigos distintos implementado.
- Reservas de equipo sin solapes: chequeo previo **más** índice único parcial **más** manejo del 23505.
- Ajuste IPC no se aplica dos veces: triple guard.
- Insignias sin doble otorgamiento (centinela `period_key DEFAULT '1970-01-01'` con el razonamiento comentado).
- Aritmética de deducciones CPP/CPP2/EI/WorkSafeBC correcta, con prorrateo por bandas. **Neto negativo es imposible.**
- Cálculo de los 11 festivos de BC correcto, incluido el algoritmo de Pascua.
- Anonimato de `daily_checkins` bien diseñado; la sugerencia de ánimo triste nunca se persiste.
- `stripe/confirm` no confía precios del cliente: usa la fila de `quotes` verificada por `user_id` y valida el método de pago contra el SetupIntent real.
- `/public/*`: sin fuga de PII en ninguna de las dos rutas.
- `qbo_export_lines` tiene idempotencia real por `(order_id, transaction_type)`.
- Offboarding distingue correctamente los servicios en curso y corta la sesión auth.

**Sospechas que resultaron falsas:**

- *"`cron/qc-rework-expiry` cambia estado sin guarda"* → falso, la guarda está. El problema real es solo de efectos secundarios duplicados.
- *"Rechazar una cotización permite reservarla online"* → falso: la rama de rechazo no limpia `admin_review_required` y `stripe/confirm:176` bloquea con 403.
- *"`.neq()` encadenado se interpreta como OR en PostgREST"* → falso, se combina con AND.
- *"Orden huérfana con hold cobrado en `stripe/confirm`"* → descartado para tarjeta; el hold se autoriza a T-72h. El riesgo existe solo en PayPal.
- *"`/api/empleado/safety-abort/[id]` sin comprobación de propiedad"* → cubierto por RLS. Pero si esa ruta migrara a service-role, se rompería en silencio.
- *"Los reembolsos parciales pueden dejar `total_paid` negativo"* → hay `Math.max(0, ...)`; el problema es la doble resta, no el signo.
- *"38 páginas admin huérfanas"* (informe previo) → ya estaba descartado; el nav usa plantillas.

---

## 7. Orden de corrección sugerido

No es un plan de trabajo, es un orden de riesgo. Las tres primeras son de bajo esfuerzo y alto impacto; la cuarta es el trabajo grande.

1. **RAÍZ-2** (`cancel` sin auth) — un `else { return 401 }`. Cierra un vector de fraude con captura de tarjeta ajena.
2. **RAÍZ-1** (RLS de `orders`) — restringir el UPDATE del cliente por columna o retirarlo. Antes conviene confirmar si algún flujo legítimo depende de él. Cierra la Cadena 1 completa.
3. **B-P0-1 y B-P0-5** — un filtro `capture_force_full_by is null` y un descuento de billetera en el retry. Dos líneas que eliminan los dos caminos de doble cobro más probables.
4. **RAÍZ-3** (unidades) — migración de `orders.*` a centavos. Es el trabajo grande y debe planificarse aparte: **cualquier parche parcial sobre las columnas `INTEGER` de dólares agrava la divergencia** en vez de reducirla.
5. **D-P0-4, D-P0-5, D-P0-1, D-P0-2, D-P0-3** — el bloque de nómina. Riesgo legal (BC ESA, CRA), no solo económico.
6. **D-P0-6** — el cálculo del lunes en `weekly-scores`. Una línea, y resucita medio sistema de confianza (la otra mitad la bloquea A-6).

**Una decisión de producto precede a todo lo de RBAC:** el negocio pide un rol "Finanzas" que hoy no existe. Crearlo sobre el recurso `finance` actual entregaría de paso SEO, experimentos A/B, migración legacy y comisiones de partners (C-H5). Esa decisión debe tomarse antes de tocar la matriz.

---

*Todo lo anterior es resultado de análisis de código y admite ser cuestionado archivo por archivo. Donde un comentario del repositorio y su código se contradicen, este informe manda el código.*

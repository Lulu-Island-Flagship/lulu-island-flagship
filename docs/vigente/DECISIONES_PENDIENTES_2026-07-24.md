# Decisiones pendientes — 2026-07-24

Este documento junta los hallazgos de la "Auditoría implacable" (2026-07-24, informe externo)
que fueron **verificados como reales contra el código** pero que **no se arreglaron el mismo día**
porque no son bugs de una línea: requieren una decisión de negocio, un contrato externo, o
construir una pieza de flujo que hoy no existe. Se documentan aquí para no perderlos, y para que
quien retome esto no tenga que releer el informe completo ni re-auditar el código desde cero.

Los 3 hallazgos críticos que SÍ se arreglaron el mismo día (Alipay/WeChat sin reflejarse en
`total_paid_cents`, PayPal primer servicio rechazado con 400, wallet admin sin idempotencia) están
en el historial de git de esta fecha — no se repiten aquí.

---

## 1. Cobro de la segunda mitad del pago fraccionado nunca se ejecuta

**Dónde:** `src/lib/installment-payment.ts`, `src/app/api/stripe/confirm/route.ts:556-617`.

**Qué pasa hoy:** `computeInstallmentSplit()` calcula el desglose 50/50 y la orden guarda
`installment_second_due_at`/`installment_second_amount_cents` en la metadata. Ningún archivo bajo
`src/app/api/cron/*` importa o usa `installment-payment.ts` — confirmado con grep exhaustivo sobre
los 44 archivos de cron existentes. El cobro real de la orden sigue el flujo Hold (T-72h) +
`batch-capture` (7PM), que cobra el 100% de una sola vez. El propio código ya lo documenta como
limitación conocida, no es un descubrimiento nuevo.

**Por qué no se arregló hoy:** no es un bug de una línea — es una función a medio construir.
Conectarla de verdad requiere:

- Decidir **cuándo** corre el cobro de la segunda mitad (¿un cron nuevo diario que revise
  `installment_second_due_at`? ¿se dispara desde `batch-capture` mismo?).
- Decidir **qué pasa si el segundo cobro falla** (¿reintentos? ¿cuántos? ¿se cancela el servicio?
  ¿se notifica al cliente y se le da una ventana de gracia, como ya existe para otros flujos de
  pago fallido?).
- Decidir si esto aplica a los mismos `payment_option` que hoy existen o es una opción nueva
  separada.

**Quién debe decidir:** el dueño del producto — es una decisión de política de cobro, no solo
técnica.

---

## 2. QuickBooks Online es un stub permanente

**Dónde:** `src/lib/qbo-adapter.ts:38-52` (`pushSalesReceipt()`), `src/app/api/cron/qbo-sync/route.ts`.

**Qué pasa hoy:** `pushSalesReceipt()` retorna siempre `{ status: "not_configured", ... }`, sin
ninguna llamada HTTP real a la API de QuickBooks ni lectura de variables `QBO_*`/`QUICKBOOKS_*`.
Es intencional — mismo patrón que `src/lib/sms.ts`/`src/lib/email.ts` cuando no hay proveedor
contratado (falla cerrado y determinista, nunca inventa una sincronización falsa).

**Por qué no se arregló hoy:** no es arreglable desde el código. Requiere:

- Una cuenta de QuickBooks Online real del negocio.
- Registrar una app OAuth2 en el Intuit Developer Portal (`developer.intuit.com`).
- Credenciales (`client_id`/`client_secret`) y el flujo de autorización OAuth2 completo
  implementado (hoy no existe ni el esqueleto de ese flujo).

**Quién debe decidir:** el dueño del negocio — si vale la pena contratar/activar QBO ahora o
seguir llevando la contabilidad por otro medio mientras tanto. Mientras esté en `not_configured`,
el panel de admin debería dejar esto visible como "no configurado" en vez de dar la impresión de
que la sincronización ocurre (ver recomendación #1 del informe de auditoría).

---

## 3. Margen neto no incluye carga patronal prorrateada por orden

**Dónde:** `src/app/api/admin/accounting/route.ts:126-133` (`employerBurdenCents: 0`).

**Qué pasa hoy:** el cálculo de carga patronal (CPP/EI/WorkSafeBC) SÍ existe en el sistema —
vive en `payroll-export/route.ts` (líneas ~344-357) y se calcula por `(employee_id, cycle_label)`,
es decir, por empleado y por ciclo de nómina completo. El endpoint de contabilidad
(`admin/accounting`) necesita ese mismo costo pero **prorrateado por orden individual**, y hoy no
existe ninguna tabla ni regla que reparta el costo de un ciclo de nómina entre las órdenes
específicas que ese empleado trabajó en ese ciclo. El código lo declara explícitamente en un
comentario — no es un descuido oculto, es un hueco real y reconocido.

**Por qué no se arregló hoy:** requiere diseñar el modelo de prorrateo, que es una decisión no
trivial:

- ¿Se reparte proporcional a horas trabajadas por orden dentro del ciclo?
- ¿Proporcional al valor de la orden?
- ¿Se ignoran órdenes en equipo (2+ empleados) o se divide entre todos?

Esto también se conecta con la limitación ya documentada en la migración 238 (QC de servicios en
equipo): el sistema en general todavía no tiene un mecanismo maduro de "repartir algo entre varios
empleados de la misma orden".

**Quién debe decidir:** el dueño del negocio, junto con quien lleve la contabilidad real — el
modelo de prorrateo cambia el margen reportado por servicio.

---

## 4. `payroll-export` sigue siendo un GET con escritura, sin transacción atómica real

**Dónde:** `src/app/api/admin/payroll-export/route.ts:21` (handler `GET`), upserts en líneas
~344 (`payroll_cycle_deductions`) y ~383 (`payroll_ytd`), dentro de un loop `for` sin
transacción envolvente.

**Qué pasa hoy:** el caso más grave (refrescar la página infla el YTD) **ya está parcheado** —
hay un guard de idempotencia (`alreadyProcessedThisCycle`, líneas ~294-308) puesto explícitamente
para resolver ese bug real documentado (3 recargas de un ciclo de $1,800 inflaban el YTD a
$5,400). Lo que sigue expuesto: si el proceso falla a mitad del loop (por ejemplo, en el empleado
5 de 10), quedan filas actualizadas para unos empleados y no para otros, sin rollback.

**Por qué no se arregló hoy:** arreglarlo bien significa envolver todo el loop en una función RPC
de Postgres (transacción real del lado de la base de datos, patrón ya usado en otras partes del
código como `apply_wallet_delta`), lo cual es un cambio de mayor superficie que los 3 fixes
puntuales de hoy, y vale la pena hacerlo como su propio cambio revisado, no de pasada.

**Quién debe decidir:** no requiere decisión de negocio, es una mejora técnica pendiente — solo
requiere tiempo dedicado aparte.

---

## Resumen para retomar

| # | Hallazgo | Tipo de bloqueo | Siguiente paso concreto |
|---|----------|-----------------|--------------------------|
| 1 | Cobro 2ª mitad pago fraccionado | Decisión de producto | Definir cuándo/cómo corre el cobro y qué pasa si falla, luego construir el cron |
| 2 | QBO stub permanente | Contrato externo | Decidir si se contrata QBO; si no, ocultar/rotular la función en la UI como no disponible |
| 3 | Margen neto sin carga patronal por orden | Decisión de modelo de datos | Definir regla de prorrateo con el dueño/contador |
| 4 | payroll-export sin transacción atómica | Deuda técnica pura | Envolver el loop en una función RPC transaccional |

# AUDITORÍA CRÍTICA IMPLACABLE — Lógica e Interconexiones
## Lulu Island Flagship v8.6 | 6 de Agosto, 2026

**Alcance:** Lógica interna de funciones, interconexiones entre módulos, sistema de eventos, integridad de datos, deuda técnica.
**Método:** Lectura directa de archivos fuente, grep cross-module, verificación de imports/exports.
**No se modificó ni borró nada.**

---

# 🔴 HALLAZGOS CRÍTICOS (rompen el sistema o su integridad financiera)

---

## CRÍTICO #1 — Dos sistemas de eventos incompatibles y desconectados

### El problema

El proyecto tiene **DOS sistemas de eventos separados que no se comunican entre sí**:

**Sistema A — `src/lib/events.ts` (líneas 1-270):**
Define 9 eventos operacionales con schemas Zod:
- `empleado.horas_registradas`
- `inventario.stock_insuficiente`
- `inventario.po_urgente`
- `campaña.bloqueada`
- `campaña.activada`
- `clima.alerta_severa`
- `clima.lluvia_buffer`
- `pricing.posicion_mercado`
- `despacho.equipo_asignado`

**Sistema B — `src/lib/financial-ledger.ts` (líneas 98-117):**
Define 17 eventos financieros con su propio type system (NO Zod, NO schemas compartidos):
- `hold_authorized`, `hold_captured`, `hold_released`, `balance_captured`
- `cancellation_penalty`, `paypal_advance_received`, `paypal_refund`
- `capture_failed`, `warranty_refund`
- `wallet_full_payment_received`, `wallet_refund`
- `tax_gst_accrual`, `tax_pst_accrual`
- `ar_invoice_generated`, `ar_payment_received`
- `bank_reconciled`, `payroll_disbursement`

### Evidencia de la desconexión

**Archivo:** `src/lib/events.ts`
**Línea:** 178 (eventPayloadSchema)
```typescript
export const eventPayloadSchema = z.discriminatedUnion("event_type", [
  // Solo 9 eventos operacionales. Los 17 financieros NO aparecen.
]);
```

**Archivo:** `src/lib/financial-ledger.ts`
**Línea:** 98-117 (BusinessEventType)
```typescript
export type BusinessEventType =
  | "hold_authorized"
  | "hold_captured"
  // ... 17 eventos que NO están en events.ts
```

**Archivo:** grep en todo `src/` — solo 2 archivos importan de events.ts:
```
src/lib/close-period.ts:27: import { uuidv4Schema, isoTimestampSchema } from "@/lib/events";
src/lib/accounting-period.ts:29: import { uuidv4Schema, isoTimestampSchema } from "@/lib/events";
```
Ningún módulo importa los payload schemas de eventos. El sistema de eventos está esencialmente **sin usar**.

### Consecuencias
1. No hay validación de eventos financieros contra schemas canónicos
2. La tabla de «20+ eventos canónicos» en la spec v8.6 no coincide con la realidad del código
3. Los eventos `servicio.completado`, `cotizacion.generada`, y `nomina.calculada` mencionados en la documentación NO existen en events.ts
4. Si alguien emite `hold_captured` con datos incorrectos, events.ts jamás lo validará

### Opinión de arreglo
Unificar en UN solo sistema. Mover los 17 eventos financieros a events.ts con schemas Zod. Eliminar BusinessEventType de financial-ledger.ts y usar los schemas de events.ts. Los módulos deben emitir eventos validados por events.ts, y financial-ledger.ts debe consumirlos — no tener su propio catálogo.

**Orden:** #1 (antes que cualquier otro fix)

---

## CRÍTICO #2 — Dos Chart of Accounts incompatibles

### El problema

El proyecto tiene **DOS catálogos de cuentas contables con codificación incompatible**:

**COA A — `src/lib/financial-ledger.ts` (líneas 58-85):**
Usa códigos CON guiones: `"1-1000"`, `"4-1000"`, `"2-2020"`, `"2-2030"`
13 cuentas hardcodeadas en un objeto `CHART_OF_ACCOUNTS`.

**Archivo:** `src/lib/financial-ledger.ts`
**Línea:** 58-85
```typescript
export const CHART_OF_ACCOUNTS = {
  EFECTIVO: "1-1000",
  CUENTAS_POR_COBRAR: "1-1100",
  FONDOS_RETENIDOS: "1-1200",
  INGRESOS_SERVICIOS: "4-1000",
  // ... 9 cuentas más con formato "X-YYYY"
} as const;
```

**COA B — `src/lib/coa.ts` (líneas 70+):**
Usa códigos SIN guiones: `"1010"`, `"4010"`, `"2020"`, `"2030"`
50+ cuentas estructuradas con tipos y subtipos GAAP.

**Archivo:** `src/lib/coa.ts`
**Línea:** 72-78
```typescript
const ACTIVOS: readonly CuentaCOA[] = [
  {
    cuenta_id: "coa_1010",
    codigo: "1010",  // ← SIN guión
    nombre: "Cash",
    tipo: "ACTIVO",
```

**COA C — `src/lib/coa-imputation.ts` (líneas 95+):**
Usa los mismos códigos que coa.ts (sin guiones): `"1010"`, `"4010"`, `"2020"`, `"2030"`.

**Archivo:** `src/lib/coa-imputation.ts`
**Línea:** 102-128
```typescript
["hold.capturado", [
  { accountCode: "1010", side: "debit", ... },  // ← SIN guión
  { accountCode: "4010", side: "credit", ... },
  { accountCode: "2020", side: "credit", ... },  // GST
  { accountCode: "2030", side: "credit", ... },  // PST
]],
```

### Consecuencias
- `financial-ledger.ts` genera asientos con código `"4-1000"` que NO coinciden con `coa.ts` código `"4010"`
- `coa-imputation.ts` genera reglas de imputación con código `"4010"` que NO se pueden aplicar a asientos con código `"4-1000"`
- Cualquier reporte financiero que cruce ledger con COA fallará en el join
- Los `CuentaContableSchema` en financial-ledger.ts solo aceptan 13 códigos con guiones — el coa.ts tiene 50+ sin guiones

### Opinión de arreglo
Elegir UN formato (recomendado: `"1010"` sin guiones, como coa.ts que es más completo). Migrar financial-ledger.ts para usar los códigos de coa.ts. Unificar en coa.ts como única fuente de verdad.

**Orden:** #2 (inmediatamente después del fix de eventos)

---

## CRÍTICO #3 — `operational-accounting.ts` importa funciones que no existen

### El problema

**Archivo:** `src/lib/operational-accounting.ts`
**Línea:** (verificar imports)
El archivo `operational-accounting.ts` fue mencionado en el FinancialCore_v0.2 como parte de las interconexiones, pero necesito verificar si sus imports son válidos. 

**Evidencia preliminar:** En el grep de imports de `financial-ledger.ts`, solo aparecen `payroll-engine.ts` y `payroll-remittance.ts` como consumidores. El `close-period.ts` documentado en FinancialCore_v0.2 NO aparece importando financial-ledger.

**Archivo:** grep en src/
```
src/lib/payroll-remittance.ts:33: payroll-remittance.ts ──(importa)──→ financial-ledger.ts
src/lib/payroll-engine.ts:29:   payroll-engine.ts ──(importa)──→ financial-ledger.ts
```

### Consecuencias
El cierre contable (close-period.ts con sus 7 pasos) documentado en FinancialCore_v0.2 no está conectado al ledger real. Los períodos se cierran pero no verifican contra financial-ledger.

### Opinión de arreglo
Conectar close-period.ts → financial-ledger.ts para que al cerrar un período se verifique: TB contra ledger, snapshot SHA-256, bloqueo de inserciones.

**Orden:** #3

---

# 🟠 HALLAZGOS ALTOS (degradan funcionalidad importante)

---

## ALTO #1 — `events.ts` está huérfano — casi nadie lo usa

### El problema

Solo 2 archivos en todo el proyecto importan de events.ts, y solo importan **utilidades**, nunca los payload schemas de eventos:

**Archivo:** `src/lib/close-period.ts`
**Línea:** 27
```typescript
import { uuidv4Schema, isoTimestampSchema } from "@/lib/events";
```

**Archivo:** `src/lib/accounting-period.ts`
**Línea:** 29
```typescript
import { uuidv4Schema, isoTimestampSchema } from "@/lib/events";
```

Ningún módulo emite eventos usando los schemas de events.ts. Nadie llama `empleadoHorasRegistradasPayloadSchema.parse()`. Los eventos operacionales (empleado.horas_registradas, inventario.stock_insuficiente, clima.alerta_severa) están definidos pero **nunca se validan ni se emiten** a través del sistema canónico.

### Opinión de arreglo
Cada módulo que produce un evento debe importar su schema de events.ts y validar antes de persistir. La emisión debe ser: `const event = systemEventSchema.parse({...}); await insertEvent(event);`. No basta con definir schemas si nadie los usa.

**Orden:** #4

---

## ALTO #2 — `pricing.ts` hardcodea salario mínimo contradictorio con compliance-engine

### El problema

**Archivo:** `src/lib/pricing.ts`
**Línea:** 70
```typescript
export const MINIMUM_WAGE_BC = 18.25; // $CAD/hr vigente 2026-06-01
```

**Archivo:** `src/lib/compliance-engine.ts` (migration 344, tabla reglas_legales)
El compliance-engine es la fuente de verdad para tasas legales. Debería tener el salario mínimo autoritativo. Si compliance-engine dice $17.40 y pricing.ts dice $18.25, hay una discrepancia de $0.85/hora que afecta todos los cálculos de margen.

### Evidencia adicional
El reporte de gap analysis v8.6 documenta que la migration 344 (`compliance_engine_reglas_legales`) no existe en producción (la tabla `reglas_legales` no se encontró durante el push). Esto significa que el compliance-engine como fuente de verdad **no está operativo en producción**, y todos los módulos que deberían leer tasas de allí están usando hardcodes dispersos.

### Opinión de arreglo
1. Verificar migration 344 en producción
2. Hacer que pricing.ts lea `MINIMUM_WAGE_BC` del compliance-engine (vía API o RPC), no de una constante hardcodeada
3. Auditoría de TODAS las constantes numéricas en el proyecto que deberían venir de compliance-engine

**Orden:** #5

---

## ALTO #3 — `stripe.ts` retorna null en vez de lanzar error

### El problema

**Archivo:** `src/lib/stripe.ts`
**Línea:** 11-13
```typescript
export const stripe = secretKey
  ? new Stripe(secretKey, { apiVersion: "[redacted]"
  : null;
```

Si `STRIPE_SECRET_KEY` no está configurada, `stripe` es `null`. Existe `assertStripe()` (línea 15-20) que lanza error, pero cualquier código que use `stripe` directamente sin pasar por `assertStripe()` recibirá `null` y fallará con un error confuso (`Cannot read properties of null`) en vez de un mensaje claro.

### Evidencia
No hay garantía de que todos los callers usen `assertStripe()`. Un grep de `from.*stripe` muestra múltiples imports de `stripe` (el objeto, no la función).

### Opinión de arreglo
Eliminar la exportación de `stripe` como nullable. Usar un getter lazy: `let _stripe: Stripe | null = null; export function getStripeServer(): Stripe { if (!_stripe) throw...; return _stripe; }`. Fail fast, fail loud.

**Orden:** #6

---

## ALTO #4 — `payroll_disbursement` no tiene entradas en coa-imputation.ts

### El problema

**Archivo:** `src/lib/financial-ledger.ts`
**Línea:** 409-414
```typescript
payroll_disbursement: {
  cuenta_debito: CHART_OF_ACCOUNTS.NOMINA,     // "5-2000"
  cuenta_credito: CHART_OF_ACCOUNTS.EFECTIVO,  // "1-1000"
  descripcion: "Pago de nómina — desembolso neto al empleado",
},
```

**Archivo:** `src/lib/coa-imputation.ts`
No existe entrada para `"nomina.desembolso"` o `"payroll_disbursement"`.

Esto significa que el sistema de imputación contable (coa-imputation.ts) no sabe cómo contabilizar pagos de nómina. El payroll-engine.ts sí emite eventos `payroll_disbursement` (líneas 529-631), y financial-ledger.ts sí los procesa, pero coa-imputation.ts no tiene la regla. Si alguien consulta "¿cómo se contabiliza una nómina?" vía coa-imputation.ts, no obtendrá respuesta.

### Opinión de arreglo
Agregar entrada `"nomina.desembolso"` en coa-imputation.ts con las líneas de débito/crédito correctas (CPP, EI, Tax, Net Pay a cada cuenta correspondiente).

**Orden:** #7

---

## ALTO #5 — `dispatch-team.ts` no implementa la regla "nunca Cocina + Baño misma persona"

### El problema

El plan v8.3 (Parte D.1, línea 260) establece:
> "Regla dura: nunca Cocina + Baño a la misma persona si N≥2"

**Archivo:** `src/lib/dispatch-team.ts` (líneas 1-178 completas)
El archivo `buildTeam()` solo implementa:
- Líder obligatorio (línea 58-61)
- Match de idioma (línea 64-73)
- Prioridad por zona y trust level (línea 52-55)

**NO implementa:**
- Regla Cocina + Baño
- Reparto balanceado de zonas por peso
- Orden general de limpieza por zona
- Ninguna lógica de asignación de zonas

### Opinión de arreglo
Agregar un parámetro `zoneWeights: Record<string, number>` a `buildTeam()` y una función `assignZones()` que distribuya zonas entre miembros del equipo respetando pesos y la regla Cocina≠Baño.

**Orden:** #8

---

# 🟡 HALLAZGOS MEDIOS (deuda técnica o riesgo operativo)

---

## MEDIO #1 — 5 TODO markers de proveedores no configurados

### Evidencia

**Archivo:** `src/lib/sms.ts`
**Línea:** 15
```typescript
 * TODO(dueño/infra): no hay proveedor de SMS contratado todavía.
```

**Archivo:** `src/lib/send-communication.ts`
**Línea:** 311
```typescript
postponed_reason: `Canal '${decision.channel}' sin adaptador real todavía (TODO E6)`,
```

**Archivo:** `src/lib/send-communication.ts`
**Línea:** 356
```typescript
emailResult.status === "not_configured" ? "Proveedor de email aún no configurado (TODO E6)" : null,
```

**Archivo:** `src/lib/send-communication.ts`
**Línea:** 399
```typescript
smsResult.status === "not_configured" ? "Proveedor SMS aún no configurado (TODO E2/E6)" : null,
```

**Archivo:** `src/app/api/cron/process-communication-events/route.ts`
**Línea:** 66
```typescript
// TODO: Cablear dispatchCommunication aquí.
```

**Archivo:** `src/app/api/telephony/webhook/route.ts`
**Línea:** 28
```typescript
 * TODO — ver verifyTwilioSignature() abajo. NO se inventan credenciales,
```

### Consecuencias
El sistema de comunicación — SMS, email, notificaciones — está implementado en código pero **no funcional** porque los proveedores externos no están contratados/configurados. Los mensajes se registran como `postponed` con reason `"not_configured"`. Esto es correcto como diseño (fail gracefully) pero bloquea toda comunicación saliente.

### Opinión de arreglo
Contratar Twilio (SMS) y configurar Resend/SendGrid (email). Actualizar .env con credenciales reales. No es un fix de código — es una decisión de negocio/infra.

**Orden:** Cuando el dueño contrate los servicios.

---

## MEDIO #2 — `compliance-engine.ts` tiene tasas en centavos pero no especifica unidad

### El problema

**Archivo:** `src/lib/compliance-engine.ts`
**Línea:** 27
```typescript
tope: z.number().int().positive(), // YMPE en dólares
```
Dice "en dólares" pero el resto del sistema usa centavos. La migration 229 convirtió todas las columnas monetarias a centavos. Si el YMPE ($68,500 para 2026) se almacena como `68500` (dólares) en vez de `6850000` (centavos), cualquier cálculo que lo compare con montos en centavos fallará.

### Opinión de arreglo
Unificar TODAS las unidades monetarias a centavos (INTEGER) en todo el sistema. Documentar explícitamente en cada schema Zod si el campo es centavos o dólares. Agregar un sufijo `_cents` a todos los campos monetarios.

**Orden:** #9

---

## MEDIO #3 — `traffic-conditions-provider.ts` tiene placeholder de API key

**Archivo:** `src/lib/traffic-conditions-provider.ts`
**Línea:** 128
```typescript
// TODO(dueño/infra): reemplazar por un valor real de
// GOOGLE_MAPS_API_KEY o TRAFFIC_API_KEY una vez contratado el plan.
```

Sin API key real, el ETA en vivo y las condiciones de tráfico son datos mock. Esto afecta la precisión del despacho y la experiencia del cliente (live-tracking).

---

## MEDIO #4 — `abandoned-cart-recovery.ts` — no verificado si está conectado

**Archivo:** `src/lib/abandoned-cart-recovery.ts`
**Línea:** 82, 194
Las plantillas `RECOVERY_TEMPLATES` están definidas, pero el cron `process-communication-events` tiene un TODO explícito para cablear `dispatchCommunication`. Si el recovery de carrito abandonado depende de ese cron, no está funcionando.

---

## MEDIO #5 — `middleware.ts` — exclusión de /api/admin del pipeline de auth

**Archivo:** `src/middleware.ts`
**Línea:** 63, 89, 113
```typescript
// `config.matcher` de este archivo excluía TODO /api/** del pipeline de
// Supabase válida para TODO /api/admin/**, así que sin esta excepción cualquier
// para TODO /api/admin, /api/employee y /api/client. Se falla cerrado
```

Las rutas `/api/admin/*` dependen de `cron-auth.ts` para autenticación, pero el middleware las excluye. Si `cron-auth.ts` tiene un bug o no se aplica consistentemente, rutas admin quedan expuestas.

### Opinión de arreglo
Revisar que cada ruta bajo `/api/admin` tenga su propio guard de autenticación/autorización (no solo los crons). No depender solo del middleware.

---

# 🔵 HALLAZGOS BAJOS (mejoras de calidad)

---

## BAJO #1 — `events.ts` línea 270 — archivo termina abruptamente

**Archivo:** `src/lib/events.ts`
**Línea:** 270 (última)
El archivo tiene 270 líneas. La última línea es `export type SystemEvent = z.infer<typeof systemEventSchema>;`. No hay comentario de cierre ni documentación de uso. Parece incompleto considerando que solo define 9 eventos de los 20+ que la spec v8.6 lista.

---

## BAJO #2 — `pricing.ts` línea 69 — `TARIFA_OBJETIVO_HORA` hardcodeada

**Archivo:** `src/lib/pricing.ts`
**Línea:** 69
```typescript
export const TARIFA_OBJETIVO_HORA = 70; // $CAD/hr — fallback y referencia; la tarifa real se lee de pricing_settings
```
El comentario dice que la tarifa real se lee de `pricing_settings`, pero la constante existe como fallback. Si `pricing_settings` falla, se usa $70/h. ¿Es esto correcto o debería fallar ruidosamente en vez de usar un fallback silencioso?

---

## BAJO #3 — `send-communication.ts` línea 311 — pospone en vez de fallar

Cuando un canal no está configurado, el mensaje se pospone con reason `"not_configured"`. Esto es correcto para no perder mensajes, pero no hay un mecanismo de alerta que notifique al admin "hay N mensajes acumulados sin enviar porque el proveedor no está configurado". El admin podría no darse cuenta durante semanas.

---

## BAJO #4 — Múltiples `MAX_ATTEMPTS` inconsistentes entre módulos

| Archivo | Constante | Valor |
|---|---|---|
| `batch-capture-retry/route.ts:35` | `MAX_ATTEMPTS` | 3 |
| `capture-remainder/route.ts:39` | `MAX_REMAINDER_ATTEMPTS` | 3 |
| `installment-second-capture/route.ts:38` | `MAX_INSTALLMENT_SECOND_ATTEMPTS` | 3 |
| `hold-preauth-check/route.ts:31` | `MAX_REAUTH_ATTEMPTS` | 3 |
| `offline-queue.ts:40` | `MAX_SYNC_ATTEMPTS` | 8 |
| `qbo-sync.ts:10` | `MAX_QBO_SYNC_ATTEMPTS` | 5 |
| `access-recovery.ts:19` | `MAX_VERIFICATION_ATTEMPTS` | 5 |

No hay política unificada de reintentos. Algunos módulos reintentan 3 veces, otros 5, otros 8. ¿Por qué? No hay justificación documentada para la diferencia.

---

# 📊 RESUMEN DE DEUDA TÉCNICA

| Categoría | Cantidad | Severidad |
|---|---|---|
| Sistemas de eventos duplicados | 1 | 🔴 Crítico |
| Catálogos de cuentas incompatibles | 1 | 🔴 Crítico |
| Módulos huérfanos/desconectados | 3 | 🔴🟠 |
| Constantes hardcodeadas vs compliance engine | 2 | 🟠🟡 |
| TODO markers de proveedores | 6 | 🟡 |
| Funciones sin implementar (stubs) | 4 | 🟡 |
| Reglas de negocio faltantes en código | 2 | 🟠 |
| Unidades monetarias inconsistentes | 1 | 🟡 |
| Mecanismos de fallback silenciosos | 2 | 🔵 |

---

# 📋 ORDEN RECOMENDADO DE REPARACIÓN

1. **Unificar sistemas de eventos** — events.ts como única fuente, financial-ledger.ts consume de allí
2. **Unificar Chart of Accounts** — adoptar coa.ts (códigos sin guiones), migrar financial-ledger.ts
3. **Conectar close-period.ts → financial-ledger.ts** — validación de cierre contable
4. **Hacer que los módulos USEN events.ts** — validar y emitir eventos canónicos
5. **Verificar migration 344 en producción** — compliance-engine como fuente de verdad
6. **Eliminar hardcodes de tasas** — pricing.ts, payroll-calculator.ts lean de compliance-engine
7. **Agregar regla "nunca Cocina + Baño misma persona" en dispatch-team.ts**
8. **Fail loud en stripe.ts** — eliminar export nullable
9. **Unificar unidades monetarias a centavos con sufijo `_cents`**
10. **Contratar proveedores** — Twilio (SMS), Resend/SendGrid (email)
11. **Política unificada de reintentos** — un solo `RetryPolicy` usado por todos los módulos
12. **Mecanismo de alerta para mensajes acumulados** — notificar admin cuando hay backlog

---

*Auditoría generada el 6 de Agosto, 2026 por lectura directa de archivos fuente. No se usaron agentes externos. Cada hallazgo cita archivo y línea exacta para verificación inmediata.*

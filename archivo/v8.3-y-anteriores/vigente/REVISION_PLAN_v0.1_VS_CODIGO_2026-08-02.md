# Revisión: Plan v0.1 Cuenta/Wallet/Pagos vs. Código Actual

**Fecha:** 2026-08-02  
**Archivo revisado:** `plan_v0.1_cuenta_pagos.md` (466 líneas)  
**Código comparado:** workspace completo en `lulu-island-flagship`  
**Método:** Lectura completa del plan + inspección de migraciones, rutas, componentes y librerías relevantes. Sin escritura ni modificación.

---

## Resumen Ejecutivo

El plan describe una arquitectura limpia y bien razonada para construir el módulo de `/cuenta` desde cero. Sin embargo, **el código ya tiene construido ~60-70% de lo que el plan propone**, aunque con diferencias arquitectónicas significativas que el plan no anticipa. La tensión principal es que el plan asume un diseño greenfield sobre `auth.users` como fuente de verdad única, mientras que el código real ya opera con **dos sistemas paralelos de cliente** (`client_profiles` legacy + `clients` del módulo de cliente) que no están unificados. Ejecutar el plan literalmente requeriría deshacer o migrar trabajo ya hecho.

---

## 1. Cumplimiento de Principios Rectores

| # | Principio | Estado en código | Observación |
|---|-----------|-----------------|-------------|
| 1 | La cuenta es un puente a reservar | ⚠️ Parcial | `/cuenta` redirige a `/servicios` (lista plana), no hay Dashboard con CTA "BOOK AGAIN". No se mide "time-to-rebook". |
| 2 | Cero callejones sin salida | ✅ Cumple | `CuentaNav` horizontal mobile-first conecta las 5 secciones. Estados vacíos tienen CTAs. |
| 3 | Onboarding progresivo | ❌ No existe | No hay wizard post-login. El teléfono se verifica inline en AuthModal, propiedad y método de pago nunca se piden proactivamente. |
| 4 | Una sola fuente de verdad | ❌ Incumplido | Dos sistemas paralelos: `client_profiles` (migración 001, usado por cotizador/Stripe) y `clients` (migración 269, usado por módulo billing). Ver §3.1. |
| 5 | No mezclar conceptos financieros | ✅ Cumple | Wallet y métodos de pago están en sistemas separados. `client_wallets` ≠ `client_payment_methods`. |
| 6 | Datos sensibles fuera de nuestra base | ✅ Cumple | PCI-DSS SAQ-A. Nunca PAN ni CVV. `client_payment_methods.provider_token` guarda referencia opaca. |

---

## 2. Estados del Cliente

El plan define 4 estados. El código actual:

- **Visitante:** ✅ Cotizador + localStorage + `PENDING_AUTH_KEY`. Coincide con el plan.
- **Cuenta creada:** ⚠️ Existe el concepto (`client_profiles` se crea al autenticar) pero **no hay Dashboard** con CTA "Reservar mi primera limpieza". El usuario aterriza en `/cuenta/servicios` con lista vacía.
- **Primer servicio / Recurrente:** ❌ No hay diferenciación. `client_profiles.services_count` existe pero no se usa para personalizar UX. No hay acceso condicional a wallet/referidos según estado.
- **North Star:** ❌ No se mide "tiempo desde crear cuenta hasta primera reserva pagada".

---

## 3. Arquitectura de Datos — Comparación Detallada

### 3.1 `user_id` canónico (Fase 0 del plan)

**Lo que pide el plan:**
> Un solo `user_id` en `auth.users` como fuente de verdad. Eliminar tablas paralelas de `clients` huérfanas.

**Lo que existe en código:**

Hay **DOS** entidades de cliente, cada una con su propio ecosistema:

| Aspecto | `client_profiles` (legacy, mig. 001) | `clients` (módulo cliente, mig. 269) |
|---------|--------------------------------------|--------------------------------------|
| PK | `id` UUID | `id` UUID |
| Vínculo a auth | `user_id UUID → auth.users(id)` UNIQUE | `auth_user_id UUID → auth.users(id)` (mig. 283, nullable, unique partial) |
| Props relacionadas | `client_properties`, `orders` | `client_module_properties`, `client_payment_methods`, `client_invoices`, `client_payments` |
| Usado por | Cotizador, AuthModal, Stripe confirm, reserva, wallet | Módulo de facturación, billing |
| phone_verified | ✅ Sí (mig. 200) | ❌ No |
| stripe_customer_id | ❌ En `orders`, no en profile | ❌ No |

**Conclusión:** El plan pide eliminar `clients` y unificar en `auth.users`. El código hizo lo opuesto: en la migración 283 **agregó** el vínculo `auth_user_id` a `clients` para conectarlo a auth, en vez de eliminarlo. Unificar estos dos sistemas es un proyecto de migración de datos significativo, no un "Fase 0, Semana 1".

### 3.2 Stripe Customer 1:1

**Plan:** `stripe_customer_id` en `auth.users`, creado una sola vez por usuario.

**Código:** `stripe_customer_id` está en la tabla `orders` (migración 001), es decir, **por orden**, no por usuario. No existe en `auth.users` ni en `client_profiles`. Esto significa que un mismo usuario podría tener múltiples Stripe Customer IDs si se crean órdenes sin reutilizar el customer existente.

**Riesgo:** Fragmentación de customers en Stripe. Cada orden podría crear un customer nuevo si el código no reutiliza.

**Archivos relevantes:** `supabase/migrations/001_modulo1_base_schema.sql:76`, `src/lib/stripe.ts`, `src/app/api/stripe/confirm/route.ts`

### 3.3 Tabla de métodos de pago

**Plan:**
```sql
CREATE TABLE user_payment_methods (
    id UUID PK,
    user_id UUID → auth.users,
    stripe_payment_method_id TEXT NOT NULL UNIQUE,
    is_default BOOLEAN,
    ...
);
-- NO guardar last_four, brand, exp_month, exp_year. Leer de Stripe.
```

**Código real** (`client_payment_methods`, migración 275):
```sql
CREATE TABLE client_payment_methods (
    id UUID PK,
    client_id UUID → clients(id) ON DELETE CASCADE,
    method_type TEXT (credit_card, pad, etransfer, cheque, invoice),
    provider TEXT,
    provider_token TEXT,        -- equivalente a stripe_payment_method_id
    last_four TEXT,             -- ⚠️ el plan dice NO guardar esto
    expiry_month SMALLINT,      -- ⚠️ el plan dice NO guardar esto
    expiry_year SMALLINT,       -- ⚠️ el plan dice NO guardar esto
    is_default BOOLEAN,
    ...
);
```

**Diferencias clave:**
- El plan vincula a `auth.users`, el código vincula a `clients(id)`.
- El plan dice explícitamente "NO guardar last_four, brand, exp_month, exp_year — leer de Stripe". El código SÍ guarda `last_four`, `expiry_month`, `expiry_year`.
- **Ambos cumplen PCI-DSS SAQ-A** (ninguno guarda PAN/CVV). La diferencia es filosófica: el plan prefiere cero duplicación a costa de una API call por carga de UI; el código acepta duplicación controlada de metadata no sensible para evitar latencia y dependency-on-Stripe-uptime en cada render.
- El código soporta más métodos (PAD, e-transfer, cheque, invoice) que el plan (solo tarjeta vía Stripe).

**Opinión:** La decisión del código es más pragmática. `last_four` y expiry son datos de display inocuos. Forzar una API call a Stripe para mostrar "Visa •••• 4242" añade latencia y un punto de fallo innecesario. El plan debería reconsiderar esta restricción.

### 3.4 Wallet

**Plan:** Ledger inmutable sin campo `balance`. Balance = `SELECT SUM(amount)`.

**Código:** Modelo híbrido:
- `client_wallets.balance` (entero, centavos) — saldo corriente mantenido atómicamente vía `apply_wallet_delta()` con `SELECT ... FOR UPDATE` (migración 180).
- `wallet_transactions` — registro inmutable de cada movimiento (ledger).
- Función `computeAvailableWalletBalance()` en `src/lib/wallet.ts` que además descuenta créditos vencidos (FIFO, expiración 12 meses).

**Conclusión:** El código ya implementa un ledger + balance cached con concurrencia estricta, que es **superior** al ledger puro del plan: evita el `SUM()` en cada lectura (que sería costoso con miles de transacciones) sin sacrificar auditabilidad. La expiración de créditos (12 meses) también está implementada y no se menciona en el plan.

**Diferencia de schema:**
- Plan: `wallet_transactions.amount` con positivo=crédito, negativo=uso. Sin `wallet_id` FK (directo a `user_id`).
- Código: `wallet_transactions` con `wallet_id FK → client_wallets(id)`, `type` enum (credit/debit/refund/promo/payout), `amount` siempre positivo, `balance_after` para auditoría. Con `request_id` para idempotencia (migración 301).

### 3.5 Tabla de transacciones de pago (agnóstica de pasarela)

**Plan:** `payment_transactions` con provider/status/metadata JSONB.

**Código:** No existe una tabla con ese nombre ni ese propósito. En su lugar hay:
- `client_payments` (migración 278): pagos aplicados a `client_invoices`, con `provider_reference`. Pertenece al subsistema de facturación del módulo de cliente.
- Sincronización Stripe vía webhook (`/api/stripe/webhook`) que actualiza `orders` directamente (status, captured_at, etc.).
- `stripe_webhook_events` para idempotencia de eventos.

**Conclusión:** El historial de pagos está fragmentado entre el webhook de Stripe (que actualiza órdenes) y el módulo de billing (que maneja invoices). El plan propone una tabla unificada que no existe. Si se construyera, habría que decidir si reemplaza, complementa o unifica estos dos sistemas.

### 3.6 Propiedades del cliente

**Plan:**
```sql
CREATE TABLE client_properties (
    id UUID PK,
    user_id UUID → auth.users,
    nickname TEXT,
    address TEXT,
    postal_code TEXT,
    zone TEXT,
    square_meters INTEGER,
    access_notes TEXT,
    is_default BOOLEAN,
    ...
);
```

**Código:** Existen **DOS** tablas de propiedades, para los dos sistemas de cliente:

| | Legacy `client_properties` (mig. 001) | `client_module_properties` (mig. 270) |
|---|---|---|
| Vinculada a | `client_profiles(id)` | `clients(id)` |
| Columnas | `nickname, address, zone, postal_code, square_feet, is_active` | `property_name, property_type, address_line1/2, city, province, postal_code, geo_lat/lng, access_instructions, cleaning_instructions, sq_ft, bedrooms, bathrooms, pets_info, parking_info, photos_allowed, status` |
| Usada por | StepAddress del cotizador, `/api/client/properties` | Módulo de cliente (billing, services) |
| `is_default` | ❌ No | ❌ No (ni en una ni en otra) |

**Diferencias:**
- El plan usa `square_meters`; ambas tablas reales usan `square_feet`.
- El plan incluye `access_notes`; la legacy no lo tiene, `client_module_properties` tiene `access_instructions`.
- El plan incluye `is_default`; ninguna tabla lo tiene.
- La legacy no tiene `nickname` como `property_name`, pero sí tiene `nickname`.
- `client_module_properties` es mucho más rica (17 columnas extra para tipo de propiedad, geolocalización, instrucciones de limpieza, mascotas, etc.).

---

## 4. Navegación y Secciones de `/cuenta`

| Sección (Plan) | Ruta (Plan) | Realidad en código |
|----------------|-------------|-------------------|
| **Dashboard** | `/cuenta` | ❌ No existe. Redirige a `/cuenta/servicios`. |
| **Mis Reservas** | `/cuenta/servicios` | ✅ Existe (`MisServiciosClient`). Lista cronológica con estados. |
| **Mis Propiedades** | `/cuenta/propiedades` | ✅ Existe (`ClientPropertiesClient`). Usa la tabla legacy `client_properties`. |
| **Billetera** | `/cuenta/billetera` | ✅ Existe (`WalletPage`). Muestra saldo + historial + órdenes no pagadas. Pero **no muestra métodos de pago (tarjetas guardadas)** — solo Lulu Credit. |
| **Perfil** | `/cuenta/perfil` | ❌ No existe como página separada. |
| — | `/cuenta/referidos` | ✅ Existe (`ReferralsPage`) — **no planeado en v0.1** del plan. |
| — | `/cuenta/preferencias` | ✅ Existe (`CommunicationPreferencesClient`) — **no planeado en v0.1** del plan. |

**CuentaNav** (barra de navegación real) tiene 5 tabs: servicios, propiedades, billetera, **referidos**, **preferencias**. El plan tiene: Dashboard, Mis Reservas, Mis Propiedades, Billetera, **Perfil**. Son conjuntos distintos.

---

## 5. Flujos de Entrada

### 5.1 Guest → Cotizador → Checkout → Auth

**Plan:** localStorage → "Reservar ahora" → AuthModal → migración de sesión anónima.

**Código:** ✅ **Implementado.** El cotizador usa `PENDING_AUTH_KEY` y `wasPendingAuth()` exactamente como describe el plan. Al autenticarse, el estado del cotizador se preserva en localStorage y se restaura. La cotización se guarda con el `user_id` correcto post-auth.

**Archivos:** `src/app/[locale]/cotizador/page.tsx` (líneas 43-100, 147-201, 869)

### 5.2 Header → Sign In

**Plan:** Redirección inteligente (volver a URL de origen o ir a `/cuenta`).

**Código:** ⚠️ **Parcial.** `CuentaNav` enlaza a "Sign In" pero el flujo post-login no tiene lógica de "volver a donde estabas". El callback de OAuth en `/auth/callback` redirige a una ruta fija.

### 5.3 Teléfono como gate universal

**Plan:** `phone_verified_at IS NULL` → bloquear reserva con modal OTP.

**Código:** ✅ **Implementado con diferencias de schema:**
- El flag es `client_profiles.phone_verified` (boolean), no `auth.users.phone_verified_at` (timestamptz).
- Se verifica en: cotizador (`page.tsx:510-531`), reserva (`[quoteId]/page.tsx:223-258`), Stripe confirm (`confirm/route.ts:209-261`).
- AuthModal marca `phone_verified = true` tras OTP SMS (`AuthModal.tsx:370-383, 430-443`).
- El gate condicional respeta si el proveedor SMS está configurado (`sms-status` endpoint).
- Google/Apple OAuth **no** marca phone_verified automáticamente — el usuario debe pasar por OTP SMS adicional.

**Conclusión:** El mecanismo es correcto y más seguro que lo que pide el plan (no confía en el phone de OAuth). La diferencia de schema (`client_profiles.phone_verified` vs `auth.users.phone_verified_at`) es menor y migrable.

---

## 6. Checkout y Stripe

| Feature | Plan | Código |
|---------|------|--------|
| Stripe Elements (tarjeta nueva) | ✅ Fase 4 | ✅ `StripeCardForm` en reserva |
| Tarjetas guardadas (radio buttons) | ✅ Fase 4 | ❌ No existe UI de selección de tarjeta guardada |
| Checkbox "guardar tarjeta" | ✅ Fase 4 | ❌ No existe |
| Apple Pay | ✅ Fase 5 (Week 6) | ✅ **Ya existe** (`ApplePayButton`) |
| Google Pay | ✅ Fase 5 (Week 6) | ⚠️ Detectado pero diferido (comentario en ApplePayButton.tsx:26) |
| Wallet en checkout (auto-aplicar) | ✅ Fase 4 | ⚠️ Parcial — `WalletPayButton` existe pero es acción explícita del usuario, no automática |
| Atomicidad wallet + tarjeta | ✅ Fase 4 | ✅ `apply_wallet_delta` es atómica con row lock |
| Alipay / WeChat Pay | ✅ Fase 8 (Week 9+) | ✅ **Ya existe** endpoint `/api/stripe/wallet-intent` |

**Conclusión:** El plan está desfasado respecto al código en cuanto a timing. Apple Pay y wallet-intent (Alipay/WeChat) ya están construidos, pero el "checkout inteligente con tarjetas guardadas" del plan (Fase 4) no existe — y es probablemente más valor para el usuario recurrente que Apple Pay para el nuevo.

---

## 7. Onboarding Post-Login

**Plan:** Wizard de 3 pasos (teléfono obligatorio → propiedad opcional → método de pago opcional) con skip visible.

**Código:** ❌ **No existe.** No hay ningún componente de onboarding post-login. El usuario autenticado aterriza directamente en `/cuenta/servicios`.

**Lo que sí existe:**
- Teléfono se verifica inline en AuthModal (no en un wizard separado).
- No se pide propiedad ni método de pago proactivamente.
- No hay banner de "completa tu perfil".
- No hay estado de "onboarding abandonado" que se reanude.

---

## 8. Wallet / Lulu Credit

**Plan:** Dos cards separadas en `/cuenta/billetera`: (1) Lulu Credit con saldo + historial, (2) Métodos de Pago con tarjetas guardadas.

**Código:** La página de billetera (`WalletPage`) muestra:
- ✅ Saldo disponible (calculado con `computeAvailableWalletBalance`, descontando créditos vencidos).
- ✅ Historial de transacciones con tipo, monto, fecha, descripción.
- ✅ Órdenes no pagadas con opción "Apply wallet credit".
- ❌ **No muestra métodos de pago (tarjetas guardadas).** Esta es una omisión significativa.

El plan dice explícitamente en §4 que Billetera debe tener "dos cards separadas". El código solo implementa la primera. La segunda (métodos de pago) no tiene UI en esta página.

---

## 9. Cancelaciones y Reembolsos

**Plan:** Cancelación >24h (ventana única), reembolso a wallet o tarjeta.

**Código:** ✅ **Más sofisticado que el plan:**
- Ventanas: >72h = reembolso total, 24-72h = 50% penalidad, <24h = 100% penalidad.
- Soporta múltiples métodos de pago: card, paypal_first_time, alipay, wechat_pay.
- Lógica en `src/lib/order-cancellation.ts` (función pura testeable) + `src/app/api/client/orders/[orderId]/cancel/route.ts`.
- Reembolso a wallet vía `apply_wallet_delta()` atómica.
- Reembolso a tarjeta vía Stripe refund.

**Diferencia:** El plan tiene una sola ventana (24h) con escape manual. El código tiene tres ventanas con política automatizada. El plan es más simple y quizás más adecuado para MVP; el código es más completo pero también más complejo.

---

## 10. Facturación GST/HST

**Plan:** Fase 6 (Week 7), PDF de invoice con GST/HST descargable.

**Código:**
- ✅ `client_invoices` (migración 276) con GST/PST separados (`gst_amount_cents`, `pst_amount_cents`).
- ✅ `client_payments` (migración 278) con función RPC atómica `record_client_payment`.
- ✅ Cotizador ya calcula GST/PST en quotes.
- ❌ **No hay generación de PDF** de invoice para el cliente.
- ❌ **No hay endpoint de descarga** desde `/cuenta/servicios`.
- ❌ Las invoices pertenecen al módulo de cliente (`clients`, service-role-only), no están expuestas al portal del cliente.

**Conclusión:** El modelo de datos está listo. Falta la capa de presentación (PDF + endpoint de descarga). El plan acierta al poner esto en una fase separada.

---

## 11. Notificaciones

**Plan:** SMS (OTP + recordatorio 24h + confirmación) y Email (recibo, confirmación, reembolso).

**Código:**
- ✅ SMS para OTP (`src/lib/sms.ts`, integrado en AuthModal).
- ⚠️ No está confirmado que existan recordatorios SMS 24h automatizados.
- ⚠️ No está confirmado que existan emails transaccionales (recibo, confirmación).
- ✅ `/cuenta/preferencias` (CommunicationPreferencesClient) existe para preferencias de notificación, aunque el plan dice "NO incluir en v0.1".

---

## 12. Fases: Plan vs. Realidad

| Fase (Plan) | Descripción | Estado real |
|-------------|-------------|-------------|
| **Fase 0** | user_id canónico, eliminar clients huérfana | ❌ No hecho. Se fue en dirección opuesta (migración 283 vinculó `clients` a auth). |
| **Fase 1** | Onboarding + Dashboard + migración sesión | ⚠️ Solo migración de sesión existe. Dashboard y wizard no. |
| **Fase 2** | Propiedades + Perfil | ⚠️ CRUD de propiedades existe (legacy). Perfil no. |
| **Fase 3** | Wallet + Métodos de Pago | ⚠️ Wallet existe. UI de métodos de pago en billetera no. |
| **Fase 4** | Checkout inteligente (tarjetas guardadas) | ❌ No existe. |
| **Fase 5** | Apple Pay + Google Pay | ✅ Apple Pay existe. Google Pay diferido. |
| **Fase 6** | Facturación GST/HST (PDF) | ⚠️ Schema existe. PDF no. |
| **Fase 7** | Cancelaciones + Reembolsos | ✅ Existe (más sofisticado que el plan). |
| **Fase 8** | PayPal + WeChat/Alipay | ⚠️ Wallet-intent endpoint existe para Alipay/WeChat. PayPal no. Medición de demanda no implementada. |

---

## 13. Hallazgos Críticos

### H1: Dos sistemas de cliente sin unificar
El plan asume `auth.users` como fuente de verdad única. El código tiene `client_profiles` + `clients` como entidades separadas con ecosistemas independientes (propiedades, billing, órdenes). **Cualquier trabajo en `/cuenta` debe decidir cuál de los dos sistemas es el canónico**, o si se unifican. Esta decisión no está en el plan.

### H2: `stripe_customer_id` está en `orders`, no en el perfil
El plan asume 1:1 entre usuario y Stripe Customer. En código, el campo está en la tabla `orders`, lo que permite (y probablemente causa) múltiples customers por usuario. Esto debe migrarse a `client_profiles` o `auth.users` antes de implementar "tarjetas guardadas".

### H3: Métodos de pago no visibles en `/cuenta/billetera`
La página de billetera muestra crédito Lulu pero no tarjetas guardadas. El plan requiere que ambas estén visibles en la misma página como "dos cards separadas". Esto es un gap funcional.

### H4: Dashboard no existe
El plan centra la experiencia en un Dashboard con CTA "BOOK AGAIN" o "Reservar mi primera limpieza". El código redirige `/cuenta` a `/cuenta/servicios` (lista plana de órdenes). No hay resumen, no hay CTA principal, no hay accesos rápidos.

### H5: El orden de fases del plan no refleja lo ya construido
Apple Pay, cancelaciones, y wallet-intent ya existen. El plan los pone en fases 5, 7 y 8. Invertir tiempo en "Fase 0" (unificar usuarios) cuando el checkout ya funciona con el sistema actual podría ser prematuro.

---

## 14. Recomendaciones

### Sobre la arquitectura de datos
1. **No eliminar `clients` aún.** La migración 283 ya lo vinculó a `auth.users`. En vez de una Fase 0 disruptiva, considerar si `client_profiles` (usado por el cotizador) y `clients` (usado por billing) pueden coexistir con un `auth_user_id` compartido, o si se unifican gradualmente.
2. **Migrar `stripe_customer_id` de `orders` a `client_profiles`.** Es un cambio pequeño con alto impacto: habilita tarjetas guardadas cross-orden.
3. **No duplicar `last_four`/`expiry` si ya están en `client_payment_methods`.** La postura del plan de "leer todo de Stripe" añade latencia sin beneficio de seguridad. La metadata no sensible es inofensiva.

### Sobre features prioritarias
4. **Dashboard antes que Apple Pay.** Apple Pay ya funciona. Lo que falta y aporta más valor al usuario recurrente es el Dashboard con CTA "BOOK AGAIN" y las tarjetas guardadas en checkout.
5. **Unificar la UI de billetera.** Agregar la card de "Métodos de Pago" (tarjetas guardadas) a `/cuenta/billetera`, junto a Lulu Credit, como pide el plan.
6. **Onboarding mínimo.** No hace falta un wizard de 3 pasos. Un banner en `/cuenta/servicios` que diga "Agrega un método de pago para reservar más rápido" + "Guarda tu dirección" ya cubre el 80% del valor con 20% del esfuerzo.

### Sobre facturación
7. **El modelo de invoices ya existe.** La Fase 6 del plan (PDF de invoice) se puede acelerar porque el schema está listo. Solo falta la capa de presentación (generación de PDF + endpoint de descarga).

### Sobre el plan mismo
8. **Actualizar el plan para reflejar lo ya construido.** Las fases 5, 7 y parte de la 8 ya están implementadas. Reordenar prioridades alrededor de los gaps reales: Dashboard, tarjetas guardadas en checkout, unificación de propiedades, y onboarding ligero.

---

## 15. Qué falta — Lista Concreta

Si se quisiera llegar al estado descrito en el plan partiendo del código actual, esto es lo que faltaría, en orden de impacto:

| # | Qué falta | Dónde | Esfuerzo estimado |
|---|-----------|-------|-------------------|
| 1 | Dashboard `/cuenta` con resumen + CTA "BOOK AGAIN" / "Reservar mi primera limpieza" | `src/app/[locale]/cuenta/page.tsx` (reemplazar redirect) | Medio |
| 2 | Mostrar tarjetas guardadas en `/cuenta/billetera` (card 2) | `src/app/[locale]/cuenta/billetera/page.tsx` | Bajo |
| 3 | Checkout con selección de tarjeta guardada (radio buttons) | `src/app/[locale]/reserva/[quoteId]/page.tsx` | Medio |
| 4 | Checkbox "guardar tarjeta" post-pago | Reserva + Stripe confirm | Bajo-Medio |
| 5 | Aplicar wallet automáticamente en checkout (no botón manual) | `src/app/[locale]/reserva/[quoteId]/page.tsx` | Bajo |
| 6 | Perfil del cliente (nombre, email, teléfono, idioma, foto) | Nueva página `/cuenta/perfil` | Medio |
| 7 | Onboarding post-login (banner/wizard ligero) | `src/app/[locale]/cuenta/layout.tsx` o `servicios/page.tsx` | Bajo-Medio |
| 8 | Migrar `stripe_customer_id` de `orders` a `client_profiles` | Migración + `stripe.ts` + `confirm/route.ts` | Medio |
| 9 | PDF de invoice descargable desde detalle de reserva | Nueva ruta API + generación PDF | Medio |
| 10 | Unificar `client_properties` legacy con `client_module_properties` (o elegir una) | Migración + cotizador + API | Alto |
| 11 | Unificar `client_profiles` con `clients` | Migración + múltiples APIs | Muy Alto |
| 12 | Google Pay (ya detectado, falta activación) | `ApplePayButton.tsx` | Bajo |
| 13 | PayPal | Nueva integración | Medio |
| 14 | Medición de demanda WeChat/Alipay (link de interés en checkout) | Reserva page | Bajo |

---

*Documento generado por revisión de código — sin modificaciones al workspace.*

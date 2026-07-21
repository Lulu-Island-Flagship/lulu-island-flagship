# AUDITORÍA GO-LIVE — Sistema Operativo de Aseo v8.3
**Auditor:** Fable 5 (externo, sin conflicto de interés) · **Fecha:** 2026-07-19
**Pregunta única:** ¿está esto listo para operar HOY con clientes reales, dinero real y empleados reales?

**Método declarado.** Leí el plan completo (`Auditoria 8.3/v8.3_PLAN_DE_CONSTRUCCION.md`, 716 líneas), el historial de git (182 commits), las 200+ migraciones, y el código real de los flujos de dinero, comunicaciones, adaptadores, seeds, CI y config de Supabase/Vercel. Ejecuté la porción crítica de la suite de tests (61/61 pasan en pricing/payroll/batch-capture-eligibility/rules). Lo que NO verifiqué ejecutándolo contra una base viva lo marco explícitamente como tal. No corregí nada.

---

## 1. VEREDICTO EJECUTIVO

**NO está listo para operar mañana.** El motivo más grave no es un detalle: **la tubería nocturna de dinero (autorización del Hold y Batch Capture de las 7 PM) contiene un filtro PostgREST malformado que, según el código fuente de la librería instalada, hace fallar la consulta completa cada noche — y no hay Sentry ni alertas que avisen** (hallazgo P0-1). Además, **ningún cliente puede completar una reserva** porque la confirmación exige verificación telefónica por SMS y no existe proveedor de SMS contratado ni habilitado (P0-2), y **el sitio público ya afirma "insured"** sin pólizas compradas, violando el invariante B.2.25 del propio plan (P0-4). El código base es de una calidad muy superior a la típica —los adaptadores fallan cerrado y con honestidad, la matemática de dinero está testeada— pero el sistema, como conjunto operable, depende de ~10 servicios externos no contratados y de una lista de trámites del mundo real que nadie ha hecho. Estimación honesta: esto es un excelente **staging**, no una operación lista.

---

## 2. BLOQUEANTES PARA LANZAR (P0)

### P0-1 · Filtro `.not("status","in",[...])` malformado en 9 rutas — rompe Hold nocturno y Batch Capture
- **Archivos:** `src/app/api/cron/hold-authorize/route.ts:61`, `src/app/api/cron/batch-capture/route.ts:197`, `src/app/api/cron/batch-capture-retry/route.ts:152`, `src/app/api/cron/hold-preauth-check/route.ts:81`, `src/app/api/cron/cash-exposure-monitor/route.ts:75`, `src/app/api/cron/morning-conditions-check/route.ts:50`, `src/app/api/cron/wellbeing-chemical-reassign/route.ts:101`, `src/app/api/admin/inventory-items/route.ts:56`, `src/app/api/admin/coworker-rotation/route.ts:51`.
- **Qué está mal:** se pasa un array JS a `.not(col, "in", ["cancelled","no_show"])`. Verifiqué la implementación instalada (`node_modules/@supabase/postgrest-js/src/PostgrestFilterBuilder.ts:1900`): `not()` interpola el valor **tal cual** (`not.${operator}.${value}`), y su propia documentación exige sintaxis PostgREST cruda. Un array serializa a `cancelled,no_show` **sin paréntesis** → parámetro `status=not.in.cancelled,no_show` → PostgREST no puede parsear el filtro → la consulta devuelve error → cada ruta retorna 500 antes de procesar una sola orden. La sintaxis correcta es la cadena `"(cancelled,no_show)"`.
- **Por qué importa:** son exactamente las rutas que autorizan Holds, cobran a las 7 PM, reintentan a las 10 PM, pre-verifican pagos y reasignan tareas químicas por bienestar. **Si esto falla, no entra dinero, y falla en silencio** (sin Sentry, el único rastro es el log de Vercel que nadie mira).
- **Advertencia de honestidad:** verificado a nivel de código fuente de la librería, no ejecutado contra un PostgREST vivo. Ninguno de los 116 archivos de test cubre estas consultas (los tests son 100% unitarios sobre funciones puras). Antes de cualquier otra cosa, esto exige una prueba de integración real. Si por alguna versión de PostgREST el filtro fuese tolerado, el hallazgo baja a P2; el hecho de que nadie pueda demostrarlo hoy es en sí mismo el problema.
- **Severidad:** Bloqueante.

### P0-2 · Ninguna reserva puede completarse: verificación SMS obligatoria sin proveedor de SMS
- **Archivos:** `src/app/api/stripe/confirm/route.ts:199` (rechaza confirmar reserva si `client_profiles.phone_verified != true`); `src/components/cotizador/AuthModal.tsx` (usa `verifyOtp` tipo `phone_change` de Supabase Auth); `supabase/config.toml:289` (`[auth.sms.twilio] enabled = false`, sin credenciales).
- **Qué está mal:** la verificación telefónica es obligatoria (correcto según E1.1) pero el OTP por SMS de Supabase Auth requiere un proveedor (Twilio/MessageBird/Vonage) que **no existe ni en config ni como cuenta contratada**. En producción, el envío del código falla → el cliente nunca queda `phone_verified` → `/api/stripe/confirm` bloquea el 100% de las reservas. Falla ruidosa para el cliente, pero mortal para el negocio el día 1.
- **Severidad:** Bloqueante.

### P0-3 · Cero comunicaciones salientes reales: SMS y email son interfaces sin proveedor
- **Archivos:** `src/lib/sms.ts` y `src/lib/email.ts` (ambos devuelven `not_configured` de forma determinista, nunca envían nada); `src/lib/send-communication.ts:352,395` registra el intento en `communication_log` y sigue.
- **Qué se rompe operativamente:** confirmación de reserva, aviso de Hold 24h antes, **SMS con link de actualización de pago cuando el Batch falla (D.10.9 — sin esto el cliente jamás se entera y el cobro muere tras 3 intentos)**, solicitud de reseña (B.2.18), avisos de no-show, encuesta pre-reseña, secuencias de retención. Es **silencioso por diseño honesto**: queda un registro `not_configured` en la base, pero ninguna alerta activa avisa al dueño de que ninguna comunicación sale.
- **Severidad:** Bloqueante (el flujo de recuperación de pagos y las confirmaciones son parte del circuito de dinero).

### P0-4 · El sitio público ya dice "insured" sin pólizas — violación del invariante B.2.25
- **Archivos:** `messages/en.json:4` (meta description: "…Verified, insured…"), `:14` (hero), `:20` ("Verified & Insured"); renderizado incondicional en `src/app/[locale]/page.tsx:114` y `:135`. Las mismas cadenas están en `fr.json` y `zh.json`.
- **Qué está mal:** el JSON-LD fue corregido para condicionar el claim al registro real de pólizas (`business_insurance_policies`, el comentario en `page.tsx:15-25` lo documenta), **pero la copia visible y el meta description siguen afirmando "insured" siempre**. El plan lo marca 🚨 BLOQUEADO hasta contratar pólizas ($5M general, $1M E&O, $2M vehicular). Es publicidad falsa hoy: riesgo legal directo y exactamente lo que B.2.25 prohíbe.
- **Severidad:** Bloqueante (se arregla quitando la palabra, pero no se puede lanzar así).

### P0-5 · Los idiomas del producto están mal: existe francés, falta español
- **Archivo:** `src/i18n/config.ts:1` — `locales = ['en', 'zh', 'fr']`. El plan (Parte A.10) define los idiomas del producto como **inglés, mandarín y español**. `messages/fr.json` existe (y encima con textos en inglés sin traducir, ej. líneas 4 y 14); `messages/es.json` no existe. En contraste, las plantillas de comunicaciones sí usan en/es/zh (`src/app/api/admin/communication-templates/route.ts:108`), o sea que el propio sistema está internamente contradictorio: un cliente hispanohablante recibiría SMS en español de un sitio que no puede mostrar español.
- **Severidad:** Bloqueante contra el plan (el dueño podría degradarlo a P1 si decide lanzar solo en-zh, pero esa decisión debe ser explícita, no un accidente).

### P0-6 · Backdoor de seed: usuarios con contraseña "password", incluido un owner_admin permanente
- **Archivo:** `supabase/seed.sql:66` — siembra `aeonwalk3r@gmail.com` como owner_admin con `crypt('password', …)`, más 7 cuentas de prueba (`owner@example.com`, `qc@example.com`, etc.) todas con contraseña "password" (línea 3 lo declara).
- **Qué está mal:** no hay ninguna salvaguarda técnica que impida ejecutar `seed.sql` contra el proyecto de producción (es el mismo repo, el mismo comando). Si eso ocurre una sola vez, existe una cuenta de dueño con contraseña "password" en un sistema con datos de tarjetas, SIN futuros y nómina. La separación staging/producción es hoy puramente disciplinaria, no técnica.
- **Severidad:** Bloqueante (exige un guard explícito o un procedimiento escrito y verificado de provisión de producción).

### P0-7 · Infraestructura de crons incompatible con el plan de hosting declarado
- **Archivo:** `vercel.json` — 43 cron jobs, varios con frecuencia `*/2`, `*/5`, `*/15` minutos (safety-abort cada 2 min, key-escalation cada 5 min, no-show cada 15 min).
- **Qué está mal:** el plan (C.1) presupuesta **Vercel Hobby**. Hobby limita los crons (pocos jobs, granularidad diaria, timing no garantizado). Con Hobby, la cadena SOS de aborto seguro (escalamiento a 2 minutos), el no-show y el Batch Capture simplemente no corren como están diseñados. Esto obliga a Vercel Pro (o un scheduler externo) — decisión y gasto que nadie ha tomado.
- **Severidad:** Bloqueante operativo.

### P0-8 · Nómina: imposible pagar y declarar legalmente — no existen SIN ni datos bancarios
- **Evidencia:** la tabla `employees` (migración `003_modulo3_employee_tables.sql:7` y todos sus ALTER posteriores) **no tiene columna de SIN ni de cuenta bancaria/direct deposit**; grep de `encrypt|pgp_sym|cipher` en todo `src/` y `supabase/` = cero resultados. El plan C.3 exige "SIN … direct deposit cifrado en reposo"; E9.3 exige export "desglose SIN". `src/lib/payroll-export.ts` no menciona SIN (solo aparece la palabra en un comentario).
- **Qué significa:** el motor calcula bien (CPP/CPP2/EI/WorkSafeBC/vacation pay, tests verdes), pero **no puede ejecutar un pago real ni generar un T4 válido** (el T4 requiere SIN). "Empleados reales" hoy = pagarles por fuera del sistema y llevar los SIN en otra parte.
- **Severidad:** Bloqueante para operar con empleados reales.

### P0-9 · Sin firma digital: contratos laborales y recurrentes no pueden firmarse
- **Archivos:** `src/lib/esignature-provider.ts` (stub `not_configured`), `src/adapters/esignature.ts`. Ni Documenso ni DocuSign contratados.
- **Qué se rompe:** onboarding de empleado (E3.1 exige contrato laboral digital firmado antes de activar) y contratos recurrentes (E2.8). Se suma a la condición B.4 aún abierta: los 3 contratos D.9 siguen siendo borradores **sin revisión de abogado de BC** — aunque hubiera proveedor de firma, firmar esos textos con personas reales está expresamente condicionado.
- **Severidad:** Bloqueante para contratar empleados o vender recurrentes.

### P0-10 · Runbook de feature flags de dinero inexistente: los defaults actuales cobran mal
- **Evidencia:** flags sembrados en `false`: `modulo_2_pagos` (seed.sql:200), `batch_capture_dispute_exclusion_enabled` (migración 080), `batch_capture_partial_on_dispute_enabled` (137), `capture_remainder_cron_enabled` (137), `batch_capture_retry_enabled` (073), `lulu_wallet_enabled` (025), `chargeback_reserve_enabled` (024), `paypal_first_service_enabled` (020), `recurring_contracts_enabled` (022), `cash_reserve_tracking_enabled` (074), `qbo_export_enabled` (023).
- **Qué está mal operativamente:** con los defaults tal cual, (a) el reintento de cobro de las 10 PM no corre; (b) **una orden con disputa crítica documentada SE COBRA igual a las 7 PM** (`batch-capture/route.ts:470+`, "flag apagado: comportamiento histórico — se cobra igual"), incumpliendo el criterio de aceptación E2 ("el Batch excluye únicamente órdenes con ticket + evidencia contradictoria"); (c) si alguien enciende la captura parcial pero no `capture_remainder_cron_enabled`, el saldo restante a 24h **no se cobra nunca** (`capture-remainder/route.ts:92` lo dice literalmente: "decisión pendiente del dueño"). No existe ningún documento que diga qué combinación de flags es la de producción.
- **Severidad:** Bloqueante (es configuración, pero configuración que cobra o deja de cobrar dinero real).

---

## 3. IMPORTANTE PERO NO BLOQUEANTE (P1)

**P1-1 · Observabilidad ciega.** `src/lib/observability.ts` — sin cuenta Sentry, sin SDK instalado; todo es `console.log` estructurado a los logs de Vercel. Combinado con P0-1/P0-3, un fallo nocturno de cobros no genera ninguna señal activa. El diseño es honesto (documenta exactamente qué falta), pero operar dinero real sin alertas es correr con los ojos vendados.

**P1-2 · Backups "offsite" que viven en el mismo proveedor.** `src/lib/backup-storage.ts:12` — los CSV+hash van al bucket `backups` de **Supabase Storage** con `destination='supabase_storage_fallback'`. El plan (E9.10, C.1) exige B2/Glacier inmutable. Si Supabase se pierde, se pierden también los backups. El `pg_dump` mensual es solo un cron de **recordatorio** (`backup-pg-dump-reminder`), no un dump real. El criterio E9 "restauración real de un pg_dump documentada" no tiene evidencia en el repo.

**P1-3 · QBO desconectado.** `src/lib/qbo-adapter.ts:38` — stub puro; sin OAuth2, sin refresh token. El sistema degrada al Shadow Ledger como fue diseñado (bien), pero: no hay Sales Receipts, no hay base para el NETFILE GST/PST trimestral "desde QBO" (E9.4), y `qbo_exports` acumulará pendientes desde el día 1. Aceptable unas semanas; no un trimestre.

**P1-4 · Geocodificación de producción sobre Nominatim gratuito.** `src/lib/geocode.ts:1-13` — Nominatim (OSM), 1 req/s, con política de uso que prohíbe uso comercial intensivo. De esta llamada dependen la geocerca de llegada (T_in), el radio de 200 m del punto de encuentro y las coordenadas de cada cotización (`/api/quote/route.ts:536`). Google Maps (stack canónico C.1) no está integrado; no hay autocomplete real de direcciones. Degrada con bypass manual (bien diseñado), pero es un cimiento frágil para el flujo físico diario.

**P1-5 · Telefonía inexistente.** `src/app/api/telephony/webhook/route.ts:23` declara "no hay cuenta de Twilio contratada"; verifica firma fail-closed (bien), pero el canal telefónico completo de E6 (número de Richmond, confirmación automática 24h — `appointment-confirmation-24h` corre cada 15 min para nada—, telefonía semántica, voicemail) es papel mojado sin cuenta, número y credenciales.

**P1-6 · Clima y tráfico: crons que no hacen nada.** `src/lib/weather-provider.ts` y `src/lib/traffic-conditions-provider.ts` son stubs `not_configured`; la excepción de clima (D.10.10) es 100% manual y el cron de las 6 AM (`morning-conditions-check`) no-opea (y además hoy crashea por P0-1). Aceptable si el admin lo sabe y lo hace a mano; nadie se lo ha dicho.

**P1-7 · Captura de reseñas incompleta sin `NEXT_PUBLIC_GOOGLE_REVIEW_URL`.** `.env.example` lo documenta bien: sin la URL real del perfil de Google Business, el botón de reseña en `/evaluar` no se muestra. El motor de crecimiento del plan (reseñas → SEO local → CAC bajo) queda apagado por una variable de entorno.

**P1-8 · Tasas de nómina 2026 hardcodeadas sin verificación profesional.** `src/lib/payroll-deductions.ts:22-43` — CPP 5.95%, EI 1.63%, WorkSafeBC 1.55% promedio, etc., con el comentario honesto de que deben confirmarse. La tasa real de WorkSafeBC depende de la clasificación del negocio, no del promedio. Antes de la primera nómina real, un contador debe firmar estas constantes; no hay mecanismo de actualización automática.

**P1-9 · Paleta de marca distinta a la canónica del plan, sin ratificación registrada.** `src/design/tokens.ts:25-31` usa `#2E5C8A`/blush `#E3AAB8` y el comentario admite "antes era navy/dorado" — D.8 define navy `#0B1E3D` / gold `#C9A961` "del logo real". Puede ser una mejora deliberada de contraste (los ratios AA están documentados), pero es una desviación del documento de verdad que el dueño debe ratificar por escrito (regla A.7c). El CI sí vigila la paleta vigente (bien).

**P1-10 · RLS: historial de parches sin re-verificación integral.** El git log muestra al menos 4 rondas de arreglos de RLS que bloqueaban flujos legítimos (commits `8a58466`, `1a8fc38`, `e8d77f9`: employees, tickets_disputas, field_audits, service_logs, capacity_slots, `/api/client/review`). Cada arreglo abre superficie nueva. No existe una suite de tests de RLS contra base viva (los 116 tests son unitarios). No encontré una vulnerabilidad concreta en lo que leí — pero afirmo explícitamente que **nadie ha demostrado que las ~90 policies actuales sean correctas en conjunto**.

**P1-11 · PayPal primera-reserva: código completo, cuenta inexistente.** `src/lib/paypal.ts` hace verificación server-side real (bien), pero sin `PAYPAL_CLIENT_ID/SECRET` y con flag `paypal_first_service_enabled=false`. Mantenerlo apagado en el lanzamiento es coherente; encenderlo sin cuenta rompería el checkout de primera vez.

**P1-12 · El documento de verdad está desactualizado respecto al código.** El plan dice (E6.6, línea 552) que el canal no tecnológico "NO [está] construido"; el commit `a3769a5` y `src/app/api/admin/phone-booking/route.ts` (577 líneas, reusa `pricing.ts` real, línea 366) demuestran que sí. Un documento de verdad que miente en cualquier dirección degrada todas las decisiones futuras (regla G: fuente única).

---

## 4. MEJORAS DESEABLES (P2)

- **Higiene del repo:** ~12 archivos basura en la raíz (`tsconfig.*.trash_*`, `*.tsbuildinfo`, `zz_stale_cache.tsbuildinfo`, carpeta `Basura/_stale_lock_junk`, `.git_commit_msg_backupcodes.txt`, `.DS_Store`). Ruido que tarde o temprano confunde un deploy.
- **Comparación de `CRON_SECRET` no constante en tiempo** (`batch-capture/route.ts:86` usa `!==`; `backup-codes.ts` sí usa `timingSafeEqual`). Riesgo teórico bajo; consistencia deseable.
- **`fr.json` y `zh.json` con meta descriptions en inglés sin traducir** (líneas 4 y 14 de ambos) — si P0-5 se resuelve manteniendo zh, la traducción CJK debe completarse con métricas tipográficas propias (D.8).
- **`hold-authorize` sin verificación de estado `confirmed`** explícito (procesa cualquier orden de tarjeta en ventana no cancelada; hoy inocuo porque las órdenes nacen confirmadas, frágil ante estados futuros).
- **Redundancia muerta:** en `batch-capture/route.ts:196-197` el `.eq("status","completed")` hace redundante el `.not(...in...)` — al corregir P0-1, simplificar.
- **Dos archivos de ejemplo de entorno** (`.env.example` y `env.example`) con contenidos distintos; consolidar.
- **`morning-conditions-check` programado a las 13:00 UTC = 6 AM Vancouver** solo en horario de verano; en invierno corre a las 5 AM (mismo patrón de doble hora que batch-capture resuelve con 2 schedules, aquí no).
- **Wallet:** el flujo de aplicar crédito usa RPC atómica (`apply_wallet_delta`, `wallet/apply/route.ts:116`) — bien — pero la presentación `total_paid = captura + wallet` merece un test de contrato que congele la semántica.
- **Los reportes de auditoría previos** (`REPORTE_E1.md` etc.) viven en la carpeta del plan; moverlos a un directorio de auditorías fechadas para no contaminar la fuente única.

---

## 5. CHECKLIST: NO ES CÓDIGO — LO TIENE QUE HACER EL DUEÑO

Nada de esta lista puede resolverla un programador. Sin esto, el sistema es una maqueta:

1. **Stripe live:** cuenta activada con verificación de identidad/negocio, claves live, webhook de producción configurado (`STRIPE_WEBHOOK_SECRET`), cuenta bancaria conectada para payouts. Hoy solo hay claves **test** (`.env.local`).
2. **Proveedor SMS (Twilio u otro):** cuenta + número **local de Richmond** + credenciales en Supabase Auth (OTP de reserva, P0-2) y en el adaptador de SMS (P0-3). Sin esto no hay reservas ni comunicaciones.
3. **Proveedor de email (SendGrid):** cuenta + dominio verificado (SPF/DKIM) + API key.
4. **Pólizas de seguro reales:** responsabilidad $5M, E&O $1M, vehicular $2M — compradas con bróker y registradas en `business_insurance_policies`. Hasta entonces, quitar "insured" del sitio (P0-4).
5. **Registro WorkSafeBC como empleador** + tasa real de clasificación (alimenta P1-8).
6. **Números de negocio:** BN de CRA, cuenta GST, registro PST de BC, cuenta de nómina (RP) para remesas CPP/EI.
7. **Abogado de BC:** revisión de los 3 contratos D.9 + respuesta escrita sobre el micro-seguro (B.4) + cláusula de mascotas (B.5.h).
8. **Proveedor de firma digital:** cuenta Documenso o DocuSign (P0-9).
9. **QuickBooks Online:** suscripción + app OAuth + conexión de cuenta bancaria del negocio.
10. **Vercel Pro** (o scheduler externo) para los 43 crons (P0-7) + dominio `app.luluisland.ca` con DNS y `NEXT_PUBLIC_APP_URL` de producción.
11. **Proyecto Supabase de producción separado** (hoy solo existe config local), con procedimiento escrito que garantice que `seed.sql` jamás lo toque (P0-6), GRANTs aplicados y el dueño como owner verificado.
12. **Todas las variables de entorno de producción:** `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, claves Stripe live, `NEXT_PUBLIC_GOOGLE_REVIEW_URL` (URL real del perfil de Google Business), `SENTRY_DSN`, etc.
13. **Backblaze B2 o S3 Glacier:** cuenta contratada y UNA restauración de prueba ejecutada y cronometrada (P1-2, criterio E9).
14. **Sentry:** cuenta + DSN + `npm install @sentry/nextjs` (P1-1).
15. **Google Business Profile:** perfil verificado del negocio (reseñas, SEO local, URL de reseña).
16. **Pendientes B.5 del plan que siguen abiertos:** validación del manual por limpiador profesional, simulacro real del Fallback de 10 min, reclutamiento, compra de insumos y proveedor, piloto con 5-10 clientes reales (obligatorio por Parte G antes de acelerar más allá de E5).
17. **Decisión de idiomas** (P0-5): confirmar en/zh/es y encargar la traducción faltante.
18. **Runbook de flags de go-live** (P0-10): decidir y documentar qué flags de dinero se encienden el día 1.

---

## 6. INTEGRACIONES EXTERNAS PENDIENTES

| Servicio | Requiere | Qué se rompe sin él | ¿Silencioso? | Código que ya lo espera |
|---|---|---|---|---|
| Stripe **live** | Cuenta verificada + claves live + webhook + banco | Todo el dinero (hoy solo test) | Ruidoso (assertStripe lanza) | `src/lib/stripe.ts`, crons de hold/capture, `stripe/webhook` |
| Twilio (Auth OTP) | Cuenta + número + config en Supabase | **Ninguna reserva se completa** | Ruidoso para el cliente | `AuthModal.tsx`, `stripe/confirm/route.ts:199`, `config.toml:289` |
| Twilio/SMS (mensajería) | Cuenta + número Richmond | Confirmaciones, link de pago fallido, reseñas, no-show | **Silencioso** (log `not_configured`) | `src/lib/sms.ts`, `send-communication.ts` |
| SendGrid | Cuenta + dominio + API key | Todo canal email | **Silencioso** | `src/lib/email.ts` |
| Twilio Voice (telefonía semántica) | Cuenta + webhook firmado | Canal telefónico E6 completo, confirmación 24h | Silencioso (cron no-opea) | `api/telephony/webhook`, `telephony-router.ts`, cron `appointment-confirmation-24h` |
| QuickBooks Online | Suscripción + OAuth2 + refresh token | Sales Receipts, base NETFILE GST/PST | Semi (cola de pendientes visible en admin) | `src/lib/qbo-adapter.ts`, cron `qbo-sync`, `qbo_exports` |
| PayPal | Cuenta business + client id/secret | Opción primera-reserva (flag ya apagado) | Apagado por flag | `src/lib/paypal.ts`, cron `paypal-refunds` |
| Documenso/DocuSign | Cuenta | Firma de contratos laborales/recurrentes | **Silencioso** (`not_configured`) | `src/lib/esignature-provider.ts`, `src/adapters/esignature.ts` |
| Google Maps/Places | API key + billing | Autocomplete real; hoy geocoding vía Nominatim gratuito (frágil/ToS) | Semi (fallback a Nominatim) | `src/lib/geocode.ts`, `src/adapters/maps.ts` |
| Environment Canada / clima | Adaptador + credenciales | Excepción clima automática (D.10.10) → manual | Silencioso | `src/lib/weather-provider.ts`, `admin/weather-exceptions` |
| OpenWeatherMap + Google Traffic | Cuentas + keys | Chequeo 6 AM, SMS de retraso >15 min | Silencioso | `src/lib/traffic-conditions-provider.ts`, cron `morning-conditions-check` |
| Sentry | Cuenta + DSN + SDK | Alertas de error (todo lo demás queda ciego) | Silencioso por definición | `src/lib/observability.ts` |
| Backblaze B2 / Glacier | Cuenta + bucket + credenciales | Backup realmente offsite; hoy va al mismo Supabase | **Silencioso** (`supabase_storage_fallback`) | `src/lib/backup-storage.ts`, crons `backup-*` |
| BC Assessment (proveedor de datos) | Proveedor de pago | Sugerencia débil de ft² (degrada bien) | Honesto (`unavailable`) | `src/lib/bc-assessment.ts` |
| Google Business Profile | Perfil verificado + URL de reseña | Botón de reseña oculto; SEO local | Silencioso (botón no aparece) | `NEXT_PUBLIC_GOOGLE_REVIEW_URL`, `/evaluar`, `gbp-checklist.ts` |

**Patrón general (a favor del código):** todos los adaptadores fallan cerrado, devuelven `not_configured` determinista, nunca simulan éxito ni inventan credenciales. Es el diseño correcto. **Patrón general (en contra de la operación):** casi todos son silenciosos — no existe un panel "salud de integraciones" que le grite al dueño qué está apagado.

---

## 7. LO QUE SÍ ESTÁ LISTO (con la misma vara)

- **Matemática de dinero testeada y correcta en lo que pude ejecutar:** corrí `payroll`, `batch-capture-eligibility`, `batch-capture-partial`, `pricing` y `rules`: **61/61 tests pasan**. La suite completa son 116 archivos de test unitario. CPP/CPP2/EI/WorkSafeBC/vacation pay con constantes 2026 y exención prorrateada (`payroll-deductions.ts`); protección de mínimo legal $18.25 y tope de rework de 30 min presentes en `payroll.ts`.
- **Ventanas de cancelación implementadas como dicta D.3:** `orders/[orderId]/cancel/route.ts` — >72h libera, 24-72h captura 50%, <24h captura 100%, PayPal con reembolso/retención/diferencia por Stripe, y maneja el caso "ya capturado por otro flujo" sin doble cobro. Devuelve wallet al cancelar.
- **Shadow Ledger real:** cada captura, captura parcial y fallo escribe una entrada (`buildShadowLedgerEntry` en batch-capture, con referencia externa a Stripe). La degradación sin QBO es genuina, no un eslogan.
- **Batch Capture bien razonado (cuando corra):** guard anti-doble-ejecución con fase dedicada (`dispatch_runs` phase `batch_capture`, bug de colisión con el scheduler ya corregido y documentado en el propio código), doble horario UTC por DST, chequeo de hora Vancouver, exclusión por disputa como función pura testeable, wallet restado sin mutar el precio sellado (B.2.11 respetado).
- **Webhook de Stripe con verificación de firma real** (`constructEvent` + secret, rechaza sin firma).
- **RBAC sólido:** matriz de 3 roles como función pura (`admin-rbac.ts`), con test de cobertura que obliga a `requireAdminRole` en rutas admin (`tests/lib/admin-rbac-coverage.test.ts`) — exactamente el tipo de guardrail que evita regresiones.
- **Seguridad de acceso del dueño:** códigos de respaldo 2FA con `timingSafeEqual` y hash (E0), recuperación de acceso por contacto de confianza con bitácora inmutable (migración 203), modo sucesión con umbrales 10/14/21 días implementados (`succession-check`).
- **Compliance como código, honesto sobre sus límites:** PIPEDA (48h acceso, 72h brecha, retención 2 años + purga — `pipeda.ts`), CASL (unsubscribe de un toque, re-engagement), calendario CRA T4/T4A/CPP-EI/GST-PST que declara explícitamente que no es asesoría fiscal (`cra-remittances.ts`), validador PIPA de lenguaje de marketing, regalos a property managers sin opción de regalo personal (riesgo s.426 bloqueado por diseño).
- **Dispatch con las reglas duras dentro del motor:** N_max=3 B2C (`enforceMaxTeamSize`), pausa de 30 min >5h, bloqueo por seguro vehicular vencido y por certificación no vigente y por descanso mínimo entre turnos, semáforo de idioma con cola pendiente (verificado en imports y lógica de `dispatch-scheduler`, no ejecutado end-to-end).
- **CI que protege invariantes reales:** typecheck + tests + grep de hex de marca fuera de tokens + prohibición de `select("*")` sobre quotes/orders en páginas cliente + auditoría axe de accesibilidad con línea base 0 críticas.
- **Privacidad del cliente:** lista explícita de columnas que el cliente jamás ve (`client-visible-columns.ts`: score, HHE, N, márgenes, riesgo de dirección), coherente con B.2.3.
- **PWA offline con diseño serio:** service worker (`public/sw.js`), cola IndexedDB con lógica pura testeable (`offline-queue.ts`), cache nocturno del día. **No verifiqué la jornada completa sin red (criterio E4) — nadie parece haberla corrido con hardware real.**
- **Canal telefónico E6.6 construido de verdad** (pese a que el plan dice lo contrario): `phone-booking` reusa `calculatePrice`/`calculateHold` del cotizador real — mismo precio garantizado por construcción.
- **Los seeds y flags nacen apagados** (cada etapa detrás de flag, como exige C.2.3), y el patrón snapshot/undo con motivo obligatorio existe desde la migración 042 con trigger que lo exige en el propio seed.

---

## Cierre

El equipo que construyó esto trabajó con una honestidad técnica poco común: los stubs se declaran stubs, los fallos cierran en vez de fingir, los comentarios documentan bugs históricos con fecha. Ese es exactamente el motivo por el que este veredicto es creíble en ambas direcciones: **lo que está bien, está bien de verdad; y lo que falta, falta de verdad.** Hoy, el sistema no puede: recibir una reserva (P0-2), cobrar de noche con confianza (P0-1), avisarle nada a nadie (P0-3), pagar ni declarar a un empleado (P0-8), ni firmar un contrato (P0-9); y afirma en público un seguro que no existe (P0-4). Resuelto eso —la mayoría es contratación de servicios y trámites, no código nuevo—, la base es sólida y el piloto de 5-10 clientes que el propio plan exige (Parte G) es el siguiente paso correcto, no el lanzamiento abierto.

*Este informe se basa en lectura directa del código y ejecución parcial de tests el 2026-07-19. Todo hallazgo es cuestionable y verificable contra los archivos citados.*

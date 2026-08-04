# Pendientes Consolidados — Lulu Island Flagship

**Fecha de consolidación:** 2026-08-03
**Fuentes:** `PENDIENTES-PARA-TI.md` (1 ago), `AUDITORIA-Y-ARREGLOS-2026-08-01.md` (1 ago), `DECISIONES_PENDIENTES_2026-07-24.md` (24 jul), análisis directo del código (3 ago)
**Qué NO está aquí:** Todo lo que ya fue arreglado (~190 fixes en 3 rondas de auditoría). Nada de lo que está en los informes como "✅ arreglado" o "verificado y correcto" se repite.

---

## 🔴 Crítico — Rompe algo hoy mismo

### 1. Funciones de BD posiblemente ausentes en producción
**Origen:** Auditoría 1 ago, §3.1 y §7
**Qué:** 14 funciones RPC que el código llama a diario (`release_capacity_slot`, `apply_payroll_cycle_deduction`, `receive_purchase_order`, `set_current_pricing_settings`, `apply_wallet_delta`, etc.) podrían no existir en producción aunque las migraciones estén marcadas como aplicadas. Ya pasó con `set_current_fixed_costs` — semanas roto en silencio.
**Acción tuya:** Ejecutar esta consulta en el SQL Editor de Supabase y mandarme el resultado:
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
**Después yo:** Por cada ❌, escribo una migración que la recree.
**Depende de ti:** Sí — necesitas acceso al panel de Supabase.

---

## 🔵 Requiere cuenta de proveedor externo

### 2. Email: contratar Resend
**Origen:** Auditoría 20 jul (B-3), análisis 3 ago
**Qué:** El código de envío de email ya está implementado (`src/lib/email.ts`, llamada real a `api.resend.com`). Solo falta la cuenta.
**Acción tuya:** Crear cuenta en [resend.com](https://resend.com) (~$20/mes), verificar dominio `luluislandflagship.ca`, setear `RESEND_API_KEY` en Vercel. Opcional: `EMAIL_FROM_ADDRESS`.
**Después yo:** Nada — ya funciona en cuanto pongas la key.

### 3. SMS: contratar Twilio
**Origen:** Auditoría 20 jul (B-3), análisis 3 ago
**Qué:** El código de envío de SMS ya está implementado (`src/lib/sms.ts`, llamada real a la API REST de Twilio). Solo falta la cuenta.
**Acción tuya:** Crear cuenta en [twilio.com](https://twilio.com) (~$20/mes), comprar un número canadiense, setear `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` en Vercel. Opcional: `TWILIO_HUMAN_ESCALATION_NUMBER`.
**Efecto secundario:** Activa automáticamente la verificación de teléfono OTP en el flujo de reserva (hoy es opcional sin SMS configurado).
**Después yo:** Nada — ya funciona.

### 4. QuickBooks Online: OAuth2
**Origen:** DECISIONES 24 jul (#2)
**Qué:** `pushSalesReceipt()` en `src/lib/qbo-adapter.ts` es un stub `not_configured`. Sin esto, la contabilidad no se sincroniza con QBO.
**Acción tuya:** Contratar QuickBooks Online, registrar app OAuth2 en [developer.intuit.com](https://developer.intuit.com), setear credenciales.
**Después yo:** Implementar el flujo OAuth2 completo (hoy no existe ni el esqueleto).

### 5. SMS de retraso al cliente: Google Maps API
**Origen:** DECISIONES 24 jul (#6)
**Qué:** El pipeline de aviso de retraso >15min al cliente (cron `morning-conditions-check`, `shouldNotifyClientOfDelay`) está construido pero `estimatedDelayMinutes` nunca se calcula porque falta `GOOGLE_MAPS_API_KEY`.
**Acción tuya:** Decidir si vale la pena contratar Google Maps Platform (Distance Matrix/Routes API, ~$5-10/mes), definir ruta de origen por zona.
**Después yo:** Conectar la API key al proveedor de tráfico y activar el cálculo real.

### 6. Google Pay: merchant verification
**Origen:** Análisis 3 ago
**Qué:** El `ApplePayButton` ya usa `PaymentRequestButtonElement` de Stripe que auto-detecta ambos wallets. Google Pay no se muestra porque falta la verificación de comerciante en el dashboard de Stripe.
**Acción tuya:** Activar Google Pay en Stripe Dashboard → Settings → Payment methods → Google Pay.
**Después yo:** Nada — el mismo botón lo detecta automáticamente.

---

## 🟠 Alta prioridad — Feature incompleta o rota

### 7. Plantillas de email de Supabase (Confirm signup + Magic Link)
**Origen:** PENDIENTES-PARA-TI.md (1 ago), Pasos 1 y 2
**Qué:** El login de clientes por email OTP funciona, pero el correo que reciben es el template default de Supabase — dice "Confirm your email address" con un link en vez del código de 6 dígitos que la pantalla de login pide. Sin este fix, ningún cliente nuevo puede terminar de loguearse por email.
**Acción tuya:** Entrar a Supabase Dashboard → Authentication → Email Templates, reemplazar "Confirm signup" y "Magic Link" con el HTML que está en `PENDIENTES-PARA-TI.md`.
**Después yo:** Nada — es copiar y pegar en el panel.
**Tiempo estimado:** 10 minutos.

### 8. Cobro de la segunda mitad del pago fraccionado nunca se ejecuta
**Origen:** DECISIONES 24 jul (#1)
**Qué:** `computeInstallmentSplit()` calcula el split 50/50 pero ningún cron hace el segundo cobro. El flujo real cobra el 100% con batch-capture.
**Bloqueado en:** Decisión de política de cobro: ¿cuándo corre el segundo cobro? ¿qué pasa si falla? ¿aplica a todas las órdenes o es opt-in?
**Quién decide:** Dueño del producto.

### 9. zoneDemand es un placeholder fijo (50)
**Origen:** DECISIONES 24 jul (#5)
**Qué:** Los 4 lugares del motor de precios que usan `zoneDemand` lo tienen hardcodeado a `50`. No existe función que calcule demanda real por zona geográfica.
**Bloqueado en:** Decisión de producto: ¿qué señal usar como proxy de demanda? ¿ventana de tiempo? ¿se cachea o se calcula por cotización?
**Quién decide:** Dueño del producto.

### 10. Flujo de contratación incompleto (pasos 2–5)
**Origen:** Auditoría 1 ago (§5, diferido 1), DECISIONES 24 jul
**Qué:** `submitStep1Application` emite un código de acceso por SMS/email, pero no existe endpoint ni página para canjearlo. Los servicios de sesión, TD1, depósito directo, documentos y firma electrónica existen (`src/lib/hiring-flow/`) pero nadie los conecta a un flujo. Tampoco hay panel admin para revisar candidatos. **Hoy un candidato real recibe un código que no puede usar.**
**Acción tuya:** Decidir si se completa el flujo o se desactiva el envío de códigos mientras tanto.
**Después yo:** Construir los pasos 2–5 + panel de RRHH.

### 11. Consentimiento legal placeholder en `/empleo`
**Origen:** Auditoría 1 ago (§5, diferido 2)
**Qué:** El checkbox de consentimiento muestra texto genérico. El texto real que el backend registra como "lo aceptado" (`pipa_step1` en migración 255) está marcado `[PLACEHOLDER — PENDIENTE DE REVISIÓN LEGAL]`. El sitio está recolectando datos personales reales con un consentimiento no aprobado por abogado.
**Acción tuya:** Conseguir texto legal redactado por asesoría en BC/PIPA.
**Después yo:** Endpoint que lo sirva + mostrarlo en el frontend.

### 12. Sin política de retención para candidatos rechazados
**Origen:** Auditoría 1 ago (§5, diferido 3)
**Qué:** No hay cron que borre/anonimice datos de candidatos rechazados. `purgeExpiredSessions()` existe pero ningún cron la llama.
**Acción tuya:** Definir período de retención (días/semanas/meses) bajo PIPA de BC.
**Después yo:** Construir el cron.

---

## 🟡 Media prioridad

### 13. Carga patronal no prorrateada por orden individual
**Origen:** DECISIONES 24 jul (#3)
**Qué:** El cálculo de carga patronal (CPP/EI/WorkSafeBC) existe para nómina completa pero no se prorratea por orden. El margen por servicio en el panel contable excluye este costo.
**Bloqueado en:** Decisión de modelo de prorrateo: ¿proporcional a horas? ¿a valor de orden? ¿cómo se reparte en servicios con 2+ empleados?
**Quién decide:** Dueño + contador.

### 14. `payroll-export` sin transacción atómica
**Origen:** DECISIONES 24 jul (#4)
**Qué:** El loop de upserts en `payroll-export` no tiene transacción envolvente. Si falla a mitad del loop, algunos empleados quedan actualizados y otros no. El caso más grave (YTD inflado por refresh) ya está parcheado con guard de idempotencia.
**Bloqueado en:** Nada técnico — es una mejora de ingeniería que requiere envolver el loop en una función RPC de Postgres. No es urgente (el parche de idempotencia funciona).
**Puedo hacerlo yo:** Sí, sin depender de ti.

### 15. Rate limit por IP en `POST /api/hiring-flow/apply`
**Origen:** Auditoría 1 ago (§5, diferido 4)
**Qué:** Solo hay dedup por email/teléfono. Un atacante puede enviar aplicaciones ilimitadas con datos distintos y quemar cuota de Twilio/Resend.
**Puedo hacerlo yo:** Sí — requiere nueva clave en `system_settings`.

### 16. i18n faltante en pantallas de empleado (`llaves`, `descansos`)
**Origen:** Auditoría 1 ago (§5, diferido 6)
**Qué:** Textos hardcodeados en español/inglés sin `useTranslations`. `descansos` además tiene textos legales de BC ESA.
**Puedo hacerlo yo:** Sí — pero `descansos` requiere que tú revises los textos legales traducidos.

### 17. Moneda hardcodeada a `en-CA` en 5-6 archivos
**Origen:** Auditoría 1 ago (§5, diferido 5)
**Dónde:** `AdminWalletClient:366`, `AdminServicioDetailClient:260`, `AdminPricingSettingsClient:471,506`, `AdminRolesClient:175`, `OrderCommunicationTimeline:100`.
**Puedo hacerlo yo:** Sí — es usar `locale` del router en vez del string fijo.

---

## ⚪ Baja prioridad / Cosmético

### 18. 12 de 45 crons corren sub-diario — no despliega en plan Hobby de Vercel
**Origen:** DECISIONES 24 jul (#8)
**Qué:** Si estás en plan Hobby (máx 1 ejecución/día por cron), el despliegue falla con 12 crons que usan `*/2`, `*/5`, `*/15` o múltiples horarios.
**Acción tuya:** Subir a plan Pro (~$20/mes) o decidir qué crons sub-diarios pueden degradarse a 1×/día.
**Impacto real:** Si ya estás en Pro, ignora esto.

### 19. i18n del back-office (admin + empleado)
**Origen:** DECISIONES 24 jul (#7)
**Qué:** Las 84 páginas de admin y empleado están hardcodeadas en inglés. El flujo de cliente sí está 100% traducido (3009 claves en 3 idiomas).
**Acción tuya:** Decidir si el staff interno necesita UI en zh/fr, o si inglés es aceptable (todo el equipo lo habla).
**Esfuerzo:** ~84 archivos × 2 idiomas extra. Semanas de trabajo.

### 20. Margen neto en panel contable no incluye carga patronal
**Origen:** DECISIONES 24 jul (#3, mismo que #13 arriba)
**Qué:** Ídem que #13. El endpoint `admin/accounting` reporta `employerBurdenCents: 0`.
**Nota:** Está duplicado aquí porque es la misma raíz que #13 — consolidar cuando se implemente.

---

## 📋 Cosas que NO están pendientes (ya hechas)

Para que quede claro y no se re-investiguen:

- ✅ `.env.example` — completo, 14+ variables documentadas, sin archivo legacy duplicado
- ✅ SavedCardSelector — existe, integrado en flujo de reserva, radio buttons con auto-select
- ✅ Dashboard "BOOK AGAIN" — el botón quickRebook va a la galería que tiene sección de rebook con fechas sugeridas
- ✅ Google Pay en frontend — el mismo botón de Apple Pay lo detecta, solo falta merchant verification
- ✅ Email/SMS stubs — YA NO son stubs, tienen implementación real con Resend y Twilio vía fetch
- ✅ RBAC en 149 endpoints — todos tienen guardia real, verificado en auditoría
- ✅ IDOR — tokens con expiración, verificación de pertenencia en todas las rutas de cliente/empleado
- ✅ i18n lado cliente — 3009 claves con paridad exacta en en/fr/zh
- ✅ Cifrado de datos sensibles — SIN, banking, backups con claves separadas
- ✅ Cola offline — respeta orden, backoff exponencial, nunca descarta items
- ✅ Stripe refund bug — arreglado (commit `a0cda6d`)
- ✅ Commit accidental revertido — recuperado (commit `2ae9664`)
- ✅ Llaves offline — ahora usa cola genérica con reintento
- ✅ Mensaje WorkSafeBC — corregido
- ✅ Entity notes — confirmación antes de borrar
- ✅ 3 bloqueadores del 20 jul — los 4 (B-1 a B-4) fueron arreglados el mismo día
- ✅ 3 bloqueadores de la segunda auditoría (20 jul b) — arreglados
- ✅ TypeScript — compila limpio (`tsc --noEmit` sin errores)
- ✅ ESLint — sin errores en archivos tocados

---

## Resumen para tu próxima sesión

Si querés avanzar en orden de impacto:

1. **Ejecutar la consulta SQL de §1** (5 min) → sabremos si hay funciones rotas en producción
2. **Configurar plantillas de email en Supabase** (10 min) → los clientes pueden loguearse
3. **Contratar Resend + Twilio** (30 min) → todas las notificaciones funcionan
4. **Decidir sobre el flujo de contratación** → si se completa o se pausa
5. **Decidir sobre el consentimiento legal** → urgente por PIPA

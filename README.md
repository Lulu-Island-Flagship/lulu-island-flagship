# Lulu Island Flagship — Módulo 1: Cotizador

Sistema de cotización premium para servicios de limpieza residencial en Richmond, BC, Canadá.

## Stack

- Next.js 14 + Tailwind CSS + TypeScript
- Supabase (Auth + PostgreSQL)
- Stripe (Módulo 2 — no activo aún)

## Configuración inicial

### 1. Clonar e instalar

```bash
git clone https://github.com/lulu-island-flagship/lulu-island-flagship.git
cd lulu-island-flagship
npm install
```

### 2. Configurar Supabase

1. Crear proyecto en [supabase.com](https://supabase.com) (free tier)
2. Ir a Project Settings → API → copiar `URL` y `anon public`
3. Copiar `.env.example` a `.env.local` y pegar tus credenciales:

```bash
cp .env.example .env.local
```

4. Editar `.env.local` con tus valores.

> **ADVERTENCIA — base de datos:** NUNCA ejecutar `supabase db reset` contra
> el proyecto de producción — reinicia toda la base y corre `seed.sql` con
> credenciales de prueba (usuarios `@example.com` y un owner_admin de prueba
> con contraseña en texto plano `"password"`). `db reset` es solo para
> entornos locales/staging. En producción solo se aplican migraciones
> (`supabase db push` o el flujo de CI/CD correspondiente). Como salvaguarda
> adicional, `supabase/seed.sql` verifica en tiempo de ejecución que está
> conectado al Postgres LOCAL que levanta `supabase start` (puerto fijo
> 54322, `inet_server_port()`) y aborta con `RAISE EXCEPTION` si detecta
> cualquier otro puerto -- ver el bloque `DO $$ ... $$` al inicio del
> archivo. La contraseña de los usuarios de prueba tampoco es un literal
> fijo: se genera aleatoriamente en cada corrida (o se puede fijar vía
> `app.seed_password` antes de `supabase db reset`).

### 3. Configurar Auth Providers en Supabase

Ir a Authentication → Providers:

- **Google**: Habilitar, configurar Client ID y Secret en Google Cloud Console
- **Apple**: Habilitar, configurar Services ID y Key ID en Apple Developer
- **Email**: Habilitar, confirmación opcional (OTP)
- **Phone**: Habilitar, configurar Twilio o MessageBird para SMS

### 4. Aplicar el esquema de base de datos

El esquema completo (tablas, RLS, funciones, triggers) vive como migraciones
versionadas en `supabase/migrations/` (300+ archivos) — ya no se mantiene
como DDL manual en este README. No pegues SQL a mano en el SQL Editor; usa
la Supabase CLI:

**Desarrollo local** (levanta Postgres local con Docker y aplica todas las
migraciones + `seed.sql`):

```bash
supabase start
supabase db reset
```

`supabase db reset` es solo para entornos locales/staging — recrea la base
desde cero, corre todas las migraciones en orden y luego `seed.sql` con
datos de prueba (usuarios `@example.com`, ver advertencia arriba).

**Proyecto remoto (staging/producción)** — enlazar el proyecto una vez y
aplicar solo migraciones nuevas, nunca `db reset`:

```bash
supabase link --project-ref <tu-project-ref>
supabase db push
```

`supabase db push` aplica únicamente las migraciones que el proyecto remoto
todavía no tiene registradas — no borra ni reinicia datos existentes. Ver
`SUPABASE_ACCESS_TOKEN`/`SUPABASE_PROJECT_ID`/`SUPABASE_DB_PASSWORD` en
`.env.example` para las credenciales que necesita la CLI (no la app).

Para crear una migración nueva:

```bash
supabase migration new nombre_descriptivo
# editar el archivo generado en supabase/migrations/
supabase db reset   # probar localmente antes de hacer push
```

### 5. Ejecutar en desarrollo

```bash
npm run dev
```

Abrir [http://localhost:3000](http://localhost:3000)

### 6. Build para producción

```bash
npm run build
```

## Estructura del proyecto

```
src/
  app/              # Next.js App Router
    page.tsx        # Landing page
    cotizador/      # Cotizador de 5 pasos
    auth/callback/  # OAuth callback
    api/quote/      # API para guardar cotizaciones
  components/       # Componentes React
    cotizador/      # Pasos del cotizador, auth modal
  lib/              # Utilidades
    pricing.ts      # Motor de precios ($70/hr)
    supabase.ts     # Cliente Supabase
  types/            # Tipos TypeScript
```

## Motor de precios

- **Tarifa objetivo**: $70 CAD/hr (editable por admin)
- **Tabla HHE**: 4 tipos de servicio × 5 rangos de ft² = 20 celdas
- **Multiplicadores**: carga orgánica (0.90×–1.30×), recencia (0.85×–1.30×)
- **Impuestos BC**: GST 5% + PST 7%
- **Hold**: MAX(fórmula_base, 40% del total)

## Módulos futuros (feature flags)

| Módulo | Descripción | Estado |
|--------|-------------|--------|
| 2 | Pagos (Stripe SetupIntent) | 🔒 |
| 3 | Reservas (calendario + slots) | 🔒 |
| 4 | PWA del empleado | 🔒 |
| 5 | Marketing in-situ | 🔒 |

## Despliegue — crons (Vercel + GitHub Actions)

**Actualización (auditoría MANIFEST v4.2, 2026-08-14):** los crons sub-diarios
críticos ya NO viven en `vercel.json`. Se migraron a
`.github/workflows/critical-crons.yml` (GitHub Actions) en 2026-08-06, así que
hoy `vercel.json` solo programa crons diarios/semanales (compatibles con el
plan Hobby de Vercel) y los sub-diarios de seguridad/dinero corren vía GitHub
Actions con `Authorization: Bearer ${CRON_SECRET}`.

El detalle de cadencia y justificación de cada cron se conserva abajo como
referencia de negocio/seguridad; para la programación REAL actual, ver
`vercel.json` (diarios/semanales) y `.github/workflows/critical-crons.yml`
(sub-diarios). Cada cron existe por una razón real y se revisó en la
auditoría m-2 (2026-07-20b):

**Relajados en esta auditoría** (ya no corren más seguido de lo necesario,
pero siguen siendo sub-diarios):
- `appointment-confirmation-24h`: de `*/15min` a hourly — el canal de
  llamada aún no tiene adaptador real (solo encola), y la ventana de
  coincidencia de 1h ya tolera una cadencia horaria sin perder órdenes.
- `qc-rework-expiry`: de `*/5min` a `*/15min` — el timer real es de 30 min;
  el peor caso solo retrasa el auto-rechazo automático ~15 min adicionales,
  sin cambiar el resultado para el empleado.
- `paypal-refunds`: de hourly a cada 4h — la obligación es reembolsar dentro
  de la ventana de >72h, así que 4h de cadencia no compromete el plazo.
- `purchase-order-reminders`: de hourly a cada 4h — los umbrales son de
  48h/72h, una cadencia más fina no aporta nada observable.

**Dejados igual, sub-diarios por diseño** (necesitan esa cadencia; no se
relajan porque degradaría una garantía de seguridad, dinero o SLA real):
- `safety-abort-escalation` (`*/2min`): escalación de aborto de seguridad en
  campo — el caso más crítico del sistema, no admite demora.
- `wellbeing-chemical-reassign` (`*/5min`): timer de 10 min de exposición
  química sin respuesta de admin → reasignación real de personal.
- `key-escalation-check` (`*/5min`): timer de 15 min de incidente de acceso
  a la propiedad del cliente (llaves) sin resolver → escalación a admin.
- `no-show` (`*/15min`): ventana de gracia de 30 min tras la hora de
  servicio; detecta y notifica al cliente dentro de esa ventana.
- `dispatch-scheduler` (`*/15min`): publica equipos/horarios de despacho del
  día siguiente en ventanas de tiempo específicas.
- `hold-authorize`, `capture-remainder`, `cash-exposure-monitor`,
  `appeal-deadline-check`, `reconcile-payments` (todos hourly): ventanas de
  cobro/autorización de Stripe y plazos de apelación atados a horas
  concretas desde el momento del servicio/evento — correr menos seguido
  introduciría demoras de cobro o riesgo financiero no cubierto.

Si el dueño del proyecto decide en algún momento operar sin Vercel Pro, la
única vía honesta es migrar estos crons a un scheduler externo (ej. GitHub
Actions, un cron de un VPS pequeño, o un servicio como cron-job.org) que
llame a estos mismos endpoints con el header `Authorization: Bearer
${CRON_SECRET}` — el código de cada ruta ya es agnóstico de quién lo invoca
(esto ya está hecho para los sub-diarios en `critical-crons.yml`).

## Licencia

Privado — Lulu Island Flagship Cleaning Services

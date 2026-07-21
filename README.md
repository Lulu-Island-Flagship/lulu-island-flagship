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
> adicional, `supabase/seed.sql` aborta automáticamente a menos que se fije
> primero la variable de sesión `app.allow_staging_seed` (ver comentarios al
> inicio del archivo).

### 3. Configurar Auth Providers en Supabase

Ir a Authentication → Providers:

- **Google**: Habilitar, configurar Client ID y Secret en Google Cloud Console
- **Apple**: Habilitar, configurar Services ID y Key ID en Apple Developer
- **Email**: Habilitar, confirmación opcional (OTP)
- **Phone**: Habilitar, configurar Twilio o MessageBird para SMS

### 4. Crear tablas en SQL Editor

```sql
-- Tabla de cotizaciones
CREATE TABLE quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  service_type TEXT NOT NULL,
  bedrooms INTEGER,
  bathrooms INTEGER,
  square_feet INTEGER,
  pets_count INTEGER DEFAULT 0,
  pets_type TEXT DEFAULT '',
  residents INTEGER DEFAULT 2,
  days_since_cleaning INTEGER DEFAULT 30,
  address TEXT,
  zone TEXT,
  postal_code TEXT,
  base_price NUMERIC,
  organic_multiplier NUMERIC,
  organic_adjustment NUMERIC,
  recency_multiplier NUMERIC,
  recency_adjustment NUMERIC,
  zone_surcharge NUMERIC DEFAULT 0,
  logistics_surcharge NUMERIC DEFAULT 0,
  subtotal NUMERIC,
  gst NUMERIC,
  pst NUMERIC,
  total NUMERIC,
  hold_amount NUMERIC,
  price_frozen_until TIMESTAMPTZ,
  status TEXT DEFAULT 'pending',
  consent_tc BOOLEAN DEFAULT FALSE,
  consent_pipa BOOLEAN DEFAULT FALSE,
  consent_marketing BOOLEAN DEFAULT FALSE,
  client_score INTEGER DEFAULT 50,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla de perfiles de cliente
CREATE TABLE client_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) UNIQUE,
  score INTEGER DEFAULT 50,
  services_count INTEGER DEFAULT 0,
  disputes_count INTEGER DEFAULT 0,
  no_show_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla de feature flags
CREATE TABLE feature_flags (
  nombre TEXT PRIMARY KEY,
  activo BOOLEAN DEFAULT FALSE,
  modulo TEXT,
  descripcion TEXT
);

-- Tabla de zonas
CREATE TABLE zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  surcharge_amount NUMERIC DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seeds de feature flags
INSERT INTO feature_flags (nombre, activo, modulo, descripcion) VALUES
  ('modulo_2_pagos', FALSE, 'Módulo 2', 'Stripe SetupIntent + Batch Capture'),
  ('modulo_3_reservas', FALSE, 'Módulo 3', 'Calendario y slots de reserva'),
  ('modulo_4_pwa', FALSE, 'Módulo 4', 'PWA del empleado'),
  ('modulo_5_marketing', FALSE, 'Módulo 5', 'Marketing in-situ y retención'),
  ('modulo_6_excepciones', FALSE, 'Módulo 6', 'Orquestación de excepciones');

-- Seeds de zonas
INSERT INTO zones (name, surcharge_amount) VALUES
  ('Richmond (Steveston)', 0),
  ('Richmond (City Centre)', 0),
  ('Richmond (East)', 0),
  ('Vancouver (West)', 25),
  ('Vancouver (East)', 20),
  ('Burnaby', 20),
  ('North Shore', 30),
  ('Surrey', 35),
  ('Delta', 25),
  ('New Westminster', 20);

-- Políticas RLS (Row Level Security)
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own quotes" ON quotes
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own quotes" ON quotes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own profile" ON client_profiles
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own profile" ON client_profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);
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

## Despliegue — requisito de plan Vercel (Pro, no Hobby)

**Este proyecto requiere Vercel Pro (o equivalente) para desplegarse.** El
plan Hobby de Vercel solo permite crons con cadencia diaria (una vez al
día); `vercel.json` define ~14 crons con cadencia sub-diaria (cada hora o más
frecuente), que fallarán a desplegar en Hobby. Esto no es un descuido — cada
uno existe por una razón de negocio/seguridad real y se revisó explícitamente
en la auditoría m-2 (2026-07-20b) para relajar los que se podían relajar sin
romper su propósito:

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
${CRON_SECRET}` — el código de cada ruta ya es agnóstico de quién lo invoca.

## Licencia

Privado — Lulu Island Flagship Cleaning Services

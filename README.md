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
3. Copiar `env.example` a `.env.local` y pegar tus credenciales:

```bash
cp env.example .env.local
```

4. Editar `.env.local` con tus valores.

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

## Licencia

Privado — Lulu Island Flagship Cleaning Services

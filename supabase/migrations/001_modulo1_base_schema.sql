-- Migración base: tablas fundamentales de Módulo 1 (Adquisición / Motor Comercial)
-- y tablas transversales requeridas por migraciones posteriores.
-- Ejecutar en SQL Editor de Supabase en entornos frescos.

-- ============================================================
-- 1. Feature flags (usados por Módulo 3 y subsiguientes)
-- ============================================================
CREATE TABLE IF NOT EXISTS feature_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL UNIQUE,
  activo BOOLEAN NOT NULL DEFAULT false,
  modulo TEXT NOT NULL,
  descripcion TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 2. Perfiles de usuario (referenciados por API de empleado)
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  phone TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 3. Perfiles de cliente (score de confianza + tipo de cuenta)
-- ============================================================
CREATE TABLE IF NOT EXISTS client_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  score INTEGER NOT NULL DEFAULT 50 CHECK (score >= -100 AND score <= 100),
  services_count INTEGER NOT NULL DEFAULT 0,
  disputes_count INTEGER NOT NULL DEFAULT 0,
  no_show_count INTEGER NOT NULL DEFAULT 0,
  account_type TEXT NOT NULL DEFAULT 'b2c'
    CHECK (account_type IN ('b2c', 'b2b', 'government')),
  company_name TEXT,
  payment_terms TEXT, -- net_30, net_60, net_90 (solo B2B/Gob)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 4. Multi-propiedad del cliente (corrección auditoría M1)
-- ============================================================
CREATE TABLE IF NOT EXISTS client_properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_profile_id UUID NOT NULL REFERENCES client_profiles(id) ON DELETE CASCADE,
  nickname TEXT,
  address TEXT NOT NULL,
  zone TEXT NOT NULL,
  postal_code TEXT,
  square_feet INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 5. Órdenes (Módulo 2; creada aquí porque Módulo 3 la referencia)
-- ============================================================
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  service_date DATE NOT NULL,
  service_time TIME NOT NULL,
  service_datetime TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled', 'no_show')),
  stripe_customer_id TEXT,
  stripe_payment_method_id TEXT,
  stripe_setup_intent_id TEXT,
  payment_option TEXT NOT NULL DEFAULT 'card'
    CHECK (payment_option IN ('card', 'paypal_first_time')),
  paypal_transaction_id TEXT,
  hold_amount INTEGER NOT NULL DEFAULT 0,
  hold_captured_at TIMESTAMPTZ,
  hold_released_at TIMESTAMPTZ,
  cancellation_window_hours INTEGER NOT NULL DEFAULT 72,
  admin_review_required BOOLEAN NOT NULL DEFAULT false,
  admin_review_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 6. Cotizaciones (Módulo 1)
-- ============================================================
CREATE TABLE IF NOT EXISTS quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Entrada del cotizador
  service_category TEXT,
  service_subtype TEXT NOT NULL,
  service_type TEXT NOT NULL,
  bedrooms INTEGER NOT NULL,
  bathrooms INTEGER NOT NULL,
  square_feet INTEGER NOT NULL,
  pets_count INTEGER NOT NULL DEFAULT 0,
  pets_type TEXT NOT NULL DEFAULT 'none',
  residents INTEGER NOT NULL DEFAULT 1,
  days_since_cleaning INTEGER NOT NULL,
  address TEXT NOT NULL,
  zone TEXT NOT NULL,
  postal_code TEXT NOT NULL,
  day_of_week INTEGER,
  is_preferred_day BOOLEAN,
  -- Desglose de precio (recalculado siempre en servidor)
  base_price INTEGER NOT NULL,
  organic_multiplier NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  organic_adjustment INTEGER NOT NULL DEFAULT 0,
  recency_multiplier NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  recency_adjustment INTEGER NOT NULL DEFAULT 0,
  zone_surcharge INTEGER NOT NULL DEFAULT 0,
  logistics_surcharge INTEGER NOT NULL DEFAULT 0,
  rule_adjustment INTEGER NOT NULL DEFAULT 0,
  applied_rules JSONB NOT NULL DEFAULT '[]',
  subtotal INTEGER NOT NULL,
  gst NUMERIC(10,2) NOT NULL,
  pst NUMERIC(10,2) NOT NULL,
  total NUMERIC(10,2) NOT NULL,
  hold_amount INTEGER NOT NULL,
  -- Control de cotización
  price_frozen_until TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'reserved', 'expired')),
  admin_review_required BOOLEAN NOT NULL DEFAULT false,
  admin_review_reason TEXT,
  estimated_labor_cost INTEGER,
  estimated_margin_contribution NUMERIC(5,2),
  -- Consentimientos y auditoría clickwrap
  consent_tc BOOLEAN NOT NULL DEFAULT false,
  consent_pipa BOOLEAN NOT NULL DEFAULT false,
  consent_marketing BOOLEAN NOT NULL DEFAULT false,
  tc_version TEXT NOT NULL DEFAULT 'v1.0',
  pipa_version TEXT NOT NULL DEFAULT 'v1.0',
  marketing_version TEXT NOT NULL DEFAULT 'v1.0',
  consent_ip TEXT,
  consent_accepted_at TIMESTAMPTZ,
  -- Score del cliente al momento de cotizar
  client_score INTEGER NOT NULL DEFAULT 50,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quotes_user_id ON quotes(user_id);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);
CREATE INDEX IF NOT EXISTS idx_quotes_price_frozen_until ON quotes(price_frozen_until);

-- ============================================================
-- 7. Motor de reglas headless (Fase 1.3)
-- ============================================================
CREATE TABLE IF NOT EXISTS pricing_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  condition_json JSONB NOT NULL, -- estructura declarativa {and/or: [...]}
  action_type TEXT NOT NULL CHECK (action_type IN ('price_multiplier', 'price_add', 'price_set', 'block', 'flag_for_review')),
  action_value NUMERIC(10,2),
  priority INTEGER NOT NULL DEFAULT 0,
  max_applicable BOOLEAN NOT NULL DEFAULT true, -- si acumula con otras reglas
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pricing_rules_active ON pricing_rules(is_active);
CREATE INDEX IF NOT EXISTS idx_pricing_rules_priority ON pricing_rules(priority DESC);

CREATE TABLE IF NOT EXISTS rule_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID REFERENCES pricing_rules(id) ON DELETE SET NULL,
  previous_rule JSONB,
  new_rule JSONB,
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rule_audit_logs_rule ON rule_audit_logs(rule_id);
CREATE INDEX IF NOT EXISTS idx_rule_audit_logs_created ON rule_audit_logs(created_at);

-- ============================================================
-- 8. RLS básico
-- ============================================================
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE rule_audit_logs ENABLE ROW LEVEL SECURITY;

-- Función auxiliar para supervisor (repetida explícitamente para entornos sin migración 003)
CREATE OR REPLACE FUNCTION is_supervisor(user_uuid UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM employees e WHERE e.user_id = user_uuid AND e.role = 'supervisor'
  );
END;
$$;

-- Feature flags: lectura pública
DROP POLICY IF EXISTS "Public read feature flags" ON feature_flags;
CREATE POLICY "Public read feature flags" ON feature_flags
  FOR SELECT USING (true);

-- Profiles: usuarios propios
DROP POLICY IF EXISTS "Users read own profile" ON profiles;
CREATE POLICY "Users read own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);
DROP POLICY IF EXISTS "Users update own profile" ON profiles;
CREATE POLICY "Users update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- Client profiles: usuarios propios, supervisores todos
DROP POLICY IF EXISTS "Users read own client profile" ON client_profiles;
CREATE POLICY "Users read own client profile" ON client_profiles
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Supervisors read all client profiles" ON client_profiles;
CREATE POLICY "Supervisors read all client profiles" ON client_profiles
  FOR SELECT USING (is_supervisor(auth.uid()));

-- Client properties: usuarios propios a través de su perfil, supervisores todos
DROP POLICY IF EXISTS "Users read own properties" ON client_properties;
CREATE POLICY "Users read own properties" ON client_properties
  FOR SELECT USING (
    client_profile_id IN (SELECT id FROM client_profiles WHERE user_id = auth.uid())
  );
DROP POLICY IF EXISTS "Users insert own properties" ON client_properties;
CREATE POLICY "Users insert own properties" ON client_properties
  FOR INSERT WITH CHECK (
    client_profile_id IN (SELECT id FROM client_profiles WHERE user_id = auth.uid())
  );
DROP POLICY IF EXISTS "Users update own properties" ON client_properties;
CREATE POLICY "Users update own properties" ON client_properties
  FOR UPDATE USING (
    client_profile_id IN (SELECT id FROM client_profiles WHERE user_id = auth.uid())
  );
DROP POLICY IF EXISTS "Supervisors read all properties" ON client_properties;
CREATE POLICY "Supervisors read all properties" ON client_properties
  FOR SELECT USING (is_supervisor(auth.uid()));

-- Orders: repetido también en 008, pero necesario para entornos frescos
DROP POLICY IF EXISTS "Clients read own orders" ON orders;
CREATE POLICY "Clients read own orders" ON orders
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Supervisors read all orders" ON orders;
CREATE POLICY "Supervisors read all orders" ON orders
  FOR SELECT USING (is_supervisor(auth.uid()));

-- Quotes: usuarios propios, supervisores todos
DROP POLICY IF EXISTS "Clients read own quotes" ON quotes;
CREATE POLICY "Clients read own quotes" ON quotes
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Supervisors read all quotes" ON quotes;
CREATE POLICY "Supervisors read all quotes" ON quotes
  FOR SELECT USING (is_supervisor(auth.uid()));

-- Pricing rules: lectura pública para active, escritura solo supervisor
DROP POLICY IF EXISTS "Public read active pricing rules" ON pricing_rules;
CREATE POLICY "Public read active pricing rules" ON pricing_rules
  FOR SELECT USING (is_active = true);
DROP POLICY IF EXISTS "Supervisors manage pricing rules" ON pricing_rules;
CREATE POLICY "Supervisors manage pricing rules" ON pricing_rules
  FOR ALL USING (is_supervisor(auth.uid()));

-- Rule audit logs: solo supervisores
DROP POLICY IF EXISTS "Supervisors read rule audit logs" ON rule_audit_logs;
CREATE POLICY "Supervisors read rule audit logs" ON rule_audit_logs
  FOR SELECT USING (is_supervisor(auth.uid()));
DROP POLICY IF EXISTS "Supervisors insert rule audit logs" ON rule_audit_logs;
CREATE POLICY "Supervisors insert rule audit logs" ON rule_audit_logs
  FOR INSERT WITH CHECK (is_supervisor(auth.uid()));

-- Seed: feature flag para Módulo 1
INSERT INTO feature_flags (nombre, activo, modulo, descripcion)
VALUES ('modulo_1_cotizador', true, 'Módulo 1', 'Cotizador B2C con precio transparente')
ON CONFLICT (nombre) DO UPDATE SET activo = true;

-- Seed: reglas de ejemplo con trazabilidad (pueden activarse/desactivarse desde admin)
INSERT INTO pricing_rules (name, description, condition_json, action_type, action_value, priority, max_applicable, is_active)
VALUES
  ('Recargo fin de semana', 'Sábado y domingo tienen recargo logístico', '{"and":[{"field":"dayOfWeek","op":"in","value":[0,6]}]}', 'price_add', 25, 10, true, true),
  ('Recargo North Shore', 'Zona North Shore tiene recargo', '{"and":[{"field":"zone","op":"==","value":"North Vancouver"}]}', 'price_add', 30, 20, true, true),
  ('Recargo West Vancouver', 'Zona West Vancouver tiene recargo', '{"and":[{"field":"zone","op":"==","value":"West Vancouver"}]}', 'price_add', 30, 20, true, true),
  ('Descuento cliente elite', 'Clientes con score > 80 y 10+ servicios', '{"and":[{"field":"clientScore","op":">","value":80},{"field":"servicesCount","op":">=","value":10}]}', 'price_multiplier', 0.90, 50, true, true),
  ('Bloqueo score muy bajo', 'Score < 0 requiere revisión admin', '{"and":[{"field":"clientScore","op":"<","value":0}]}', 'block', 0, 100, true, true)
ON CONFLICT DO NOTHING;

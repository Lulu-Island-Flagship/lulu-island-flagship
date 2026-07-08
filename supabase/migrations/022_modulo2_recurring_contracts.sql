-- Migración Módulo 2 — Clientes recurrentes y contratos de servicio

-- ============================================================
-- 1. Tabla de contratos de servicio recurrente
-- ============================================================
CREATE TABLE IF NOT EXISTS service_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  quote_id UUID REFERENCES quotes(id) ON DELETE SET NULL, -- quote original
  property_id UUID REFERENCES client_properties(id) ON DELETE SET NULL,

  service_subtype TEXT NOT NULL,
  frequency TEXT NOT NULL
    CHECK (frequency IN ('weekly', 'biweekly', 'monthly', 'quarterly')),
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  preferred_time TIME,

  base_price INTEGER NOT NULL,
  total INTEGER NOT NULL,
  hold_amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CAD',

  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'cancelled', 'completed')),
  start_date DATE NOT NULL,
  end_date DATE,
  next_scheduled_date DATE,

  payment_option TEXT NOT NULL DEFAULT 'card'
    CHECK (payment_option IN ('card', 'paypal_first_time')),
  stripe_customer_id TEXT,
  stripe_payment_method_id TEXT,

  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_contracts_user ON service_contracts(user_id);
CREATE INDEX IF NOT EXISTS idx_service_contracts_status ON service_contracts(status);
CREATE INDEX IF NOT EXISTS idx_service_contracts_next_date
  ON service_contracts(next_scheduled_date)
  WHERE status = 'active';

ALTER TABLE service_contracts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Clients read own contracts" ON service_contracts;
CREATE POLICY "Clients read own contracts" ON service_contracts
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Clients insert own contracts" ON service_contracts;
CREATE POLICY "Clients insert own contracts" ON service_contracts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Clients update own contracts" ON service_contracts;
CREATE POLICY "Clients update own contracts" ON service_contracts
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Supervisors read all contracts" ON service_contracts;
CREATE POLICY "Supervisors read all contracts" ON service_contracts
  FOR SELECT USING (is_supervisor(auth.uid()));

DROP POLICY IF EXISTS "Supervisors manage contracts" ON service_contracts;
CREATE POLICY "Supervisors manage contracts" ON service_contracts
  FOR ALL USING (is_supervisor(auth.uid()));

-- ============================================================
-- 2. Tabla de instancias generadas por contrato
-- ============================================================
CREATE TABLE IF NOT EXISTS contract_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES service_contracts(id) ON DELETE CASCADE,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  quote_id UUID REFERENCES quotes(id) ON DELETE SET NULL,
  scheduled_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'confirmed', 'completed', 'cancelled', 'skipped')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contract_instances_contract ON contract_instances(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_instances_date ON contract_instances(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_contract_instances_status ON contract_instances(status);

ALTER TABLE contract_instances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Clients read own contract instances" ON contract_instances;
CREATE POLICY "Clients read own contract instances" ON contract_instances
  FOR SELECT USING (
    contract_id IN (SELECT id FROM service_contracts WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Supervisors read all contract instances" ON contract_instances;
CREATE POLICY "Supervisors read all contract instances" ON contract_instances
  FOR SELECT USING (is_supervisor(auth.uid()));

DROP POLICY IF EXISTS "System insert contract instances" ON contract_instances;
CREATE POLICY "System insert contract instances" ON contract_instances
  FOR INSERT WITH CHECK (true);

-- ============================================================
-- 3. Feature flag
-- ============================================================
INSERT INTO feature_flags (nombre, activo, modulo, descripcion)
VALUES ('recurring_contracts_enabled', false, 'Módulo 2', 'Contratos de servicio recurrente')
ON CONFLICT (nombre) DO UPDATE SET activo = false;

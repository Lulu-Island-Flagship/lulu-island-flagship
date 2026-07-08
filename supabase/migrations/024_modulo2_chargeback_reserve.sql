-- Migración Módulo 2 — Reserva de chargebacks

-- ============================================================
-- 1. Configuración de porcentaje de reserva
-- ============================================================
CREATE TABLE IF NOT EXISTS chargeback_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reserve_percentage NUMERIC(5,2) NOT NULL DEFAULT 2.00
    CHECK (reserve_percentage >= 0 AND reserve_percentage <= 100),
  reserve_cap_amount INTEGER, -- tope absoluto en cents (NULL = sin tope)
  effective_from DATE NOT NULL DEFAULT now(),
  effective_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE chargeback_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Supervisors read chargeback settings" ON chargeback_settings
  FOR SELECT USING (is_supervisor(auth.uid()));

CREATE POLICY IF NOT EXISTS "Supervisors manage chargeback settings" ON chargeback_settings
  FOR ALL USING (is_supervisor(auth.uid()));

INSERT INTO chargeback_settings (reserve_percentage, effective_from)
VALUES (2.00, now())
ON CONFLICT DO NOTHING;

-- ============================================================
-- 2. Reservas por orden
-- ============================================================
CREATE TABLE IF NOT EXISTS chargeback_reserves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  payment_intent_id TEXT,
  captured_amount INTEGER NOT NULL,
  reserve_percentage NUMERIC(5,2) NOT NULL,
  reserve_amount INTEGER NOT NULL,
  released_amount INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'held'
    CHECK (status IN ('held', 'partially_released', 'released', 'applied')),
  release_date DATE, -- fecha estimada de liberación (e.g. 180 días después)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chargeback_reserves_order ON chargeback_reserves(order_id);
CREATE INDEX IF NOT EXISTS idx_chargeback_reserves_status ON chargeback_reserves(status);
CREATE INDEX IF NOT EXISTS idx_chargeback_reserves_release_date
  ON chargeback_reserves(release_date)
  WHERE status IN ('held', 'partially_released');

ALTER TABLE chargeback_reserves ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Supervisors read chargeback reserves" ON chargeback_reserves
  FOR SELECT USING (is_supervisor(auth.uid()));

CREATE POLICY IF NOT EXISTS "System insert chargeback reserves" ON chargeback_reserves
  FOR INSERT WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Supervisors update chargeback reserves" ON chargeback_reserves
  FOR UPDATE USING (is_supervisor(auth.uid()));

-- ============================================================
-- 3. Feature flag
-- ============================================================
INSERT INTO feature_flags (nombre, activo, modulo, descripcion)
VALUES ('chargeback_reserve_enabled', false, 'Módulo 2', 'Reserva de chargebacks 1-3%')
ON CONFLICT (nombre) DO UPDATE SET activo = false;

-- Migración Módulo 2 — Nómina por resultado y protección salarial

-- ============================================================
-- 1. Extender employees para pago por resultado
-- ============================================================
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS min_wage_floor_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS qc_score_threshold INTEGER NOT NULL DEFAULT 70
    CHECK (qc_score_threshold >= 0 AND qc_score_threshold <= 100),
  ADD COLUMN IF NOT EXISTS qc_bonus_per_point INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_rework_minutes INTEGER NOT NULL DEFAULT 30
    CHECK (max_rework_minutes >= 0);

-- ============================================================
-- 2. Tabla de entradas de nómina
-- ============================================================
CREATE TABLE IF NOT EXISTS payroll_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  assignment_id UUID REFERENCES assignments(id) ON DELETE SET NULL,

  -- Inputs del cálculo
  day_rate INTEGER NOT NULL,
  estimated_service_minutes INTEGER NOT NULL DEFAULT 480, -- 8h por defecto
  rework_minutes INTEGER NOT NULL DEFAULT 0,
  qc_score INTEGER, -- 0-100, puede ser NULL si aún no se evalúa

  -- Resultados del cálculo
  base_amount INTEGER NOT NULL,
  qc_bonus_amount INTEGER NOT NULL DEFAULT 0,
  qc_penalty_amount INTEGER NOT NULL DEFAULT 0,
  rework_paid_minutes INTEGER NOT NULL DEFAULT 0,
  rework_amount INTEGER NOT NULL DEFAULT 0,
  hourly_equivalent NUMERIC(10,2) NOT NULL,
  minimum_wage_adjustment INTEGER NOT NULL DEFAULT 0,

  -- Totales
  gross_amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'paid', 'disputed', 'cancelled')),

  -- Auditoría
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  payment_reference TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payroll_entries_employee ON payroll_entries(employee_id);
CREATE INDEX IF NOT EXISTS idx_payroll_entries_order ON payroll_entries(order_id);
CREATE INDEX IF NOT EXISTS idx_payroll_entries_status ON payroll_entries(status);
CREATE INDEX IF NOT EXISTS idx_payroll_entries_pending
  ON payroll_entries(employee_id, status)
  WHERE status IN ('pending', 'approved');

ALTER TABLE payroll_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Employees read own payroll" ON payroll_entries;
CREATE POLICY "Employees read own payroll" ON payroll_entries
  FOR SELECT USING (
    employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Supervisors read all payroll" ON payroll_entries;
CREATE POLICY "Supervisors read all payroll" ON payroll_entries
  FOR SELECT USING (is_supervisor(auth.uid()));

DROP POLICY IF EXISTS "Supervisors update payroll" ON payroll_entries;
CREATE POLICY "Supervisors update payroll" ON payroll_entries
  FOR UPDATE USING (is_supervisor(auth.uid()));

DROP POLICY IF EXISTS "System insert payroll" ON payroll_entries;
CREATE POLICY "System insert payroll" ON payroll_entries
  FOR INSERT WITH CHECK (true);

-- ============================================================
-- 3. Constante de salario mínimo legal de BC
-- ============================================================
CREATE TABLE IF NOT EXISTS payroll_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bc_min_wage_hourly NUMERIC(10,2) NOT NULL DEFAULT 18.25,
  effective_from DATE NOT NULL DEFAULT '2024-06-01',
  effective_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE payroll_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Supervisors read payroll settings" ON payroll_settings;
CREATE POLICY "Supervisors read payroll settings" ON payroll_settings
  FOR SELECT USING (is_supervisor(auth.uid()));

DROP POLICY IF EXISTS "Supervisors manage payroll settings" ON payroll_settings;
CREATE POLICY "Supervisors manage payroll settings" ON payroll_settings
  FOR ALL USING (is_supervisor(auth.uid()));

INSERT INTO payroll_settings (bc_min_wage_hourly, effective_from)
VALUES (18.25, '2024-06-01')
ON CONFLICT DO NOTHING;

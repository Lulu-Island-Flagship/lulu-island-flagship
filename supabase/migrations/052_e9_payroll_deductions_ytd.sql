-- Migración 052 — v8.3 E9: soporte para nómina exportable con desglose
-- CPP/CPP2/EI/WorkSafeBC/Vacation Pay (D.9 nómina completa exportable).

-- ============================================================
-- 1. Fecha de contratación (antigüedad -> tasa de Vacation Pay 4%/6%)
-- ============================================================
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS hire_date DATE;

-- ============================================================
-- 2. Acumulado anual por empleado (YTD) para prorratear los topes de
-- CPP/CPP2/EI/WorkSafeBC entre ciclos quincenales dentro del mismo año.
-- Un registro por empleado + año calendario.
-- ============================================================
CREATE TABLE IF NOT EXISTS payroll_ytd (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  calendar_year INTEGER NOT NULL,
  ytd_pensionable_cents INTEGER NOT NULL DEFAULT 0,
  ytd_insurable_cents INTEGER NOT NULL DEFAULT 0,
  ytd_assessable_cents INTEGER NOT NULL DEFAULT 0,
  ytd_cpp_contribution_cents INTEGER NOT NULL DEFAULT 0,
  ytd_cpp2_contribution_cents INTEGER NOT NULL DEFAULT 0,
  ytd_ei_employee_cents INTEGER NOT NULL DEFAULT 0,
  ytd_vacation_pay_accrued_cents INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, calendar_year)
);

ALTER TABLE payroll_ytd ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Employees read own payroll ytd" ON payroll_ytd;
CREATE POLICY "Employees read own payroll ytd" ON payroll_ytd
  FOR SELECT USING (
    employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Supervisors manage payroll ytd" ON payroll_ytd;
CREATE POLICY "Supervisors manage payroll ytd" ON payroll_ytd
  FOR ALL USING (is_supervisor(auth.uid())) WITH CHECK (is_supervisor(auth.uid()));

-- ============================================================
-- 3. Snapshot de deducciones por entrada de nómina finalizada del ciclo
-- (permite exportar CSV/PDF con el desglose completo sin recalcular).
-- ============================================================
CREATE TABLE IF NOT EXISTS payroll_cycle_deductions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  cycle_label TEXT NOT NULL, -- ej. '2026-07 Q1'
  gross_cents INTEGER NOT NULL,
  cpp_cents INTEGER NOT NULL,
  cpp2_cents INTEGER NOT NULL,
  ei_employee_cents INTEGER NOT NULL,
  ei_employer_cents INTEGER NOT NULL,
  worksafebc_employer_cents INTEGER NOT NULL,
  vacation_pay_accrual_cents INTEGER NOT NULL,
  estimated_net_cents INTEGER NOT NULL,
  employer_cost_cents INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, cycle_label)
);

CREATE INDEX IF NOT EXISTS idx_payroll_cycle_deductions_cycle ON payroll_cycle_deductions(cycle_label);

ALTER TABLE payroll_cycle_deductions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Employees read own cycle deductions" ON payroll_cycle_deductions;
CREATE POLICY "Employees read own cycle deductions" ON payroll_cycle_deductions
  FOR SELECT USING (
    employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Supervisors manage cycle deductions" ON payroll_cycle_deductions;
CREATE POLICY "Supervisors manage cycle deductions" ON payroll_cycle_deductions
  FOR ALL USING (is_supervisor(auth.uid())) WITH CHECK (is_supervisor(auth.uid()));

DROP TRIGGER IF EXISTS trg_prevent_delete ON payroll_cycle_deductions;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON payroll_cycle_deductions
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

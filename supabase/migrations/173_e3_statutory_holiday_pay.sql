-- Migración 173 — Días festivos pagados (BC ESA Parte 5 s.42-45).
-- src/lib/statutory-holidays.ts calcula las 11 fechas del año (incluyendo
-- Good Friday móvil) y la elegibilidad; el cron statutory-holiday-scan
-- genera un registro por empleado elegible con su "average day's pay"
-- cuando hay datos de salario disponibles (ver honestidad de alcance en
-- el cron: payroll_entries hoy no tiene escritor real en el código, así
-- que wage_data_unavailable puede quedar en true).

CREATE TABLE IF NOT EXISTS statutory_holiday_pay (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  holiday_name TEXT NOT NULL,
  holiday_date DATE NOT NULL,
  eligible BOOLEAN NOT NULL,
  eligibility_reason TEXT NOT NULL,
  days_worked_in_prior_30 INTEGER NOT NULL,
  wage_data_unavailable BOOLEAN NOT NULL DEFAULT false,
  average_day_pay_cents INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, holiday_date)
);

CREATE INDEX IF NOT EXISTS idx_statutory_holiday_pay_date ON statutory_holiday_pay(holiday_date);

-- Inmutable: registro de cumplimiento de una entitlement estatutaria.
DROP TRIGGER IF EXISTS trg_prevent_delete ON statutory_holiday_pay;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON statutory_holiday_pay
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

ALTER TABLE statutory_holiday_pay ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Employees read own statutory holiday pay" ON statutory_holiday_pay;
CREATE POLICY "Employees read own statutory holiday pay" ON statutory_holiday_pay
  FOR SELECT USING (
    employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Supervisors manage statutory holiday pay" ON statutory_holiday_pay;
CREATE POLICY "Supervisors manage statutory holiday pay" ON statutory_holiday_pay
  FOR ALL USING (is_supervisor(auth.uid()));

COMMENT ON TABLE statutory_holiday_pay IS
  'v8.3 BC ESA Parte 5 s.42-45: 11 festivos estatutarios de BC. src/lib/statutory-holidays.ts decide elegibilidad y average day pay. wage_data_unavailable=true significa que no había payroll_entries reales para calcular el monto -- la elegibilidad SÍ es real (viene de employees.hire_date + assignments completados).';

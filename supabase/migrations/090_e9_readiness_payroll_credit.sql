-- Migración 090 — v8.3 E9: conecta readiness_requests (modo "No estoy
-- listo") a la nómina real cuando la resolución es full_day_rate.
--
-- Antes de esta migración, readiness_requests se llenaba (POST
-- /api/empleado/readiness ya calculaba resolution='full_day_rate' via
-- evaluateReadinessRequest) pero ninguna fila de esa tabla alimentaba el
-- ciclo de nómina real (/api/admin/payroll-export). El monto nunca se
-- pagaba.
--
-- Diseño: NO se reutiliza payroll_entries directamente porque esa tabla
-- exige order_id NOT NULL (un readiness_request no está atado a una orden
-- de servicio — es un día de banca cubierto por Day Rate, B.2.6). Se crea
-- una tabla propia y payroll-export/route.ts la agrega al mismo agregador
-- puro (aggregateCycle, src/lib/payroll-cycle.ts) que ya usa para
-- payroll_entries — mismo patrón, sin duplicar la lógica de cálculo de
-- deducciones (payroll-deductions.ts sigue intacto).

CREATE TABLE IF NOT EXISTS payroll_readiness_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  readiness_request_id UUID NOT NULL UNIQUE REFERENCES readiness_requests(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  credit_date DATE NOT NULL,
  day_rate_cents INTEGER NOT NULL CHECK (day_rate_cents > 0),
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payroll_readiness_credits_employee_date
  ON payroll_readiness_credits(employee_id, credit_date);

-- Integridad: el monto SIEMPRE se calcula server-side desde employees.day_rate
-- vigente al momento del crédito, nunca se confía en lo que envíe el cliente/ruta.
CREATE OR REPLACE FUNCTION set_readiness_credit_day_rate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_day_rate INTEGER;
BEGIN
  SELECT day_rate INTO v_day_rate FROM employees WHERE id = NEW.employee_id;
  IF v_day_rate IS NULL THEN
    RAISE EXCEPTION 'Empleado % no encontrado para calcular el credito de nomina (v8.3 E9)', NEW.employee_id;
  END IF;
  NEW.day_rate_cents := v_day_rate * 100;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_readiness_credit_day_rate ON payroll_readiness_credits;
CREATE TRIGGER trg_set_readiness_credit_day_rate
  BEFORE INSERT ON payroll_readiness_credits
  FOR EACH ROW EXECUTE FUNCTION set_readiness_credit_day_rate();

ALTER TABLE payroll_readiness_credits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Employees insert own readiness credit" ON payroll_readiness_credits;
CREATE POLICY "Employees insert own readiness credit" ON payroll_readiness_credits
  FOR INSERT WITH CHECK (
    employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Employees read own readiness credit" ON payroll_readiness_credits;
CREATE POLICY "Employees read own readiness credit" ON payroll_readiness_credits
  FOR SELECT USING (
    employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Supervisors manage readiness credits" ON payroll_readiness_credits;
CREATE POLICY "Supervisors manage readiness credits" ON payroll_readiness_credits
  FOR ALL USING (is_supervisor(auth.uid())) WITH CHECK (is_supervisor(auth.uid()));

DROP TRIGGER IF EXISTS trg_prevent_delete ON payroll_readiness_credits;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON payroll_readiness_credits
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

COMMENT ON TABLE payroll_readiness_credits IS
  'v8.3 E9: credito de Day Rate completo por readiness_requests.resolution=full_day_rate. Se agrega al ciclo de nomina en /api/admin/payroll-export junto con payroll_entries.';

-- Migración 177 — FIX-11: offboarding real. Hallazgo de auditoría de flujo
-- del empleado: ningún código en todo el sistema ponía employees.is_active
-- en false -- no existía ninguna forma de dar de baja a un empleado desde
-- el producto, análogo al hallazgo de FIX-10 (onboarding).

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS terminated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS termination_reason TEXT;

-- Pago final (BC ESA): el Vacation Pay acumulado (payroll_ytd.
-- ytd_vacation_pay_accrued_cents, migración 052) debe pagarse completo al
-- terminar el empleo -- no puede quedar "pendiente para el próximo año".
-- Se registra aquí como un evento propio (no se resta directamente de
-- payroll_ytd, que es un acumulado de solo lectura histórica) y se funde al
-- ciclo de nómina con el mismo patrón que sick_leave_requests/
-- statutory_holiday_pay (CycleEntry con baseAmountCents=el pago final).
CREATE TABLE IF NOT EXISTS employee_final_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  payout_type TEXT NOT NULL CHECK (payout_type IN ('vacation_pay_accrual')),
  amount_cents INTEGER NOT NULL,
  payout_date DATE NOT NULL,
  source_calendar_year INTEGER NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, payout_type, source_calendar_year)
);

CREATE INDEX IF NOT EXISTS idx_employee_final_payouts_date ON employee_final_payouts(payout_date);

ALTER TABLE employee_final_payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Employees read own final payouts" ON employee_final_payouts;
CREATE POLICY "Employees read own final payouts" ON employee_final_payouts
  FOR SELECT USING (
    employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Supervisors manage final payouts" ON employee_final_payouts;
CREATE POLICY "Supervisors manage final payouts" ON employee_final_payouts
  FOR ALL USING (is_supervisor(auth.uid())) WITH CHECK (is_supervisor(auth.uid()));

DROP TRIGGER IF EXISTS trg_prevent_delete ON employee_final_payouts;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON employee_final_payouts
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

COMMENT ON TABLE employee_final_payouts IS
  'v8.3 FIX-11: pago final al terminar el empleo (Vacation Pay acumulado, BC ESA). Insertado por POST /api/admin/empleados/[id]/offboard, leído por payroll-export igual que sick_leave_requests/statutory_holiday_pay -- se SUMA al ciclo, nunca reemplaza otro concepto.';

-- Migración 169 — Documentación de descansos vía tránsito al carro (BC ESA
-- s.32: 30 min sin goce de sueldo tras 5h continuas). Ver honestidad de
-- alcance en src/lib/rest-documentation.ts -- el tránsito NUNCA cuenta
-- como descanso para quien conduce (sigue trabajando), solo para
-- pasajeros, y solo si ya se acumularon 5h continuas antes.

CREATE TABLE IF NOT EXISTS employee_rest_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  order_id_before UUID REFERENCES orders(id) ON DELETE SET NULL,
  order_id_after UUID REFERENCES orders(id) ON DELETE SET NULL,
  rest_start_at TIMESTAMPTZ NOT NULL,
  rest_end_at TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL,
  cumulative_continuous_minutes_before INTEGER NOT NULL,
  role_during_rest TEXT NOT NULL CHECK (role_during_rest IN ('driver', 'passenger', 'solo_no_vehicle')),
  satisfies_esa_break BOOLEAN NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, order_id_before, order_id_after)
);

CREATE INDEX IF NOT EXISTS idx_employee_rest_periods_employee_date ON employee_rest_periods(employee_id, work_date);

ALTER TABLE employee_rest_periods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Employees read own rest periods" ON employee_rest_periods;
CREATE POLICY "Employees read own rest periods" ON employee_rest_periods
  FOR SELECT USING (
    employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Supervisors read all rest periods" ON employee_rest_periods;
CREATE POLICY "Supervisors read all rest periods" ON employee_rest_periods
  FOR SELECT USING (is_supervisor(auth.uid()));

COMMENT ON TABLE employee_rest_periods IS
  'Registro de cada tramo de tránsito entre servicios (service_logs t_out -> t_in siguiente) y si calificó como el descanso legal de 30 min tras 5h continuas (BC ESA s.32). src/lib/rest-documentation.ts decide -- nunca marca el tránsito del conductor como descanso, porque manejar sigue siendo trabajo.';

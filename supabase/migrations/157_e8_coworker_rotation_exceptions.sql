-- Migración 157 — v8.3 E8.14: "Rotación de compañeros: mínimo 3 distintos
-- por mes; excepción 'nunca juntos' documentada; conflicto con idioma/zona →
-- decide admin."
--
-- No existe roster persistente de equipo (ver migración 155_e8_team_chat.sql
-- para la misma limitación) -- la composición real se lee de `assignments`.
-- Esta migración solo agrega la tabla de excepciones documentadas "nunca
-- juntos"; el análisis de rotación en sí (mínimo 3 distintos/mes) es
-- puramente de lectura sobre `assignments` y no necesita tabla propia.

CREATE TABLE IF NOT EXISTS employee_pairing_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_a_id UUID NOT NULL REFERENCES employees(id),
  employee_b_id UUID NOT NULL REFERENCES employees(id),
  reason TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  documented_by UUID REFERENCES employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT pairing_exception_distinct_employees CHECK (employee_a_id <> employee_b_id)
);

-- Un par (sin importar el orden) solo puede tener UNA excepción activa a la
-- vez -- normalizado con LEAST/GREATEST para que (A,B) y (B,A) cuenten como
-- el mismo par.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pairing_exception_unique_pair
  ON employee_pairing_exceptions (LEAST(employee_a_id, employee_b_id), GREATEST(employee_a_id, employee_b_id))
  WHERE is_active = true AND deleted_at IS NULL;

ALTER TABLE employee_pairing_exceptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Supervisors manage pairing exceptions" ON employee_pairing_exceptions;
CREATE POLICY "Supervisors manage pairing exceptions" ON employee_pairing_exceptions
  FOR ALL USING (is_supervisor(auth.uid())) WITH CHECK (is_supervisor(auth.uid()));

DROP TRIGGER IF EXISTS trg_prevent_delete ON employee_pairing_exceptions;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON employee_pairing_exceptions
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

COMMENT ON TABLE employee_pairing_exceptions IS
  'v8.3 E8.14: pares de empleados documentados como "nunca juntos". El análisis de rotación (mínimo 3 compañeros distintos/mes) se calcula en la aplicación leyendo assignments directamente, sin tabla propia.';

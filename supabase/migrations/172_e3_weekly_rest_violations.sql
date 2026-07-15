-- Migración 172 — Descanso semanal mínimo de 32h consecutivas (BC ESA
-- s.35). A diferencia del descanso de 8h entre turnos (que sí se bloquea
-- en tiempo real en el despacho, migración 169/171 y dispatch-scheduler),
-- esta regla necesita visibilidad de TODA la semana para evaluarse, así
-- que se implementa como monitoreo semanal con alerta -- no como bloqueo
-- de despacho (bloquear requeriría optimización de calendario hacia
-- adelante, fuera de alcance hoy).

CREATE TABLE IF NOT EXISTS weekly_rest_violations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  longest_gap_hours NUMERIC(6,2) NOT NULL,
  shifts_count INTEGER NOT NULL,
  acknowledged_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_weekly_rest_violations_week ON weekly_rest_violations(week_start);

ALTER TABLE weekly_rest_violations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Supervisors manage weekly rest violations" ON weekly_rest_violations;
CREATE POLICY "Supervisors manage weekly rest violations" ON weekly_rest_violations
  FOR ALL USING (is_supervisor(auth.uid()));

COMMENT ON TABLE weekly_rest_violations IS
  'v8.3 BC ESA s.35: semanas en las que un empleado no tuvo 32h consecutivas de descanso. src/lib/shift-rest.ts#evaluateWeeklyRest decide -- generado por el cron weekly-rest-check, solo alerta, no bloquea despacho.';

-- Migración 193 — v8.3 E5 (auditoría 2026-07-18): causal documentable
-- "<50 puntos x 3 semanas consecutivas".
--
-- Faltaba cualquier tabla o lógica que contara semanas consecutivas de
-- total_score < 50 (nivel 'observation'/'suspended') y dejara un registro
-- visible al admin. Esta migración SOLO crea el registro -- ninguna acción
-- automática sobre el empleado (ni suspensión, ni despido: eso sigue siendo
-- decisión humana, invariante B.2.23). El cron weekly-scores
-- (src/app/api/cron/weekly-scores/route.ts) calcula la racha después de
-- cada recálculo semanal e inserta aquí cuando llega a 3 semanas seguidas.

CREATE TABLE IF NOT EXISTS employee_low_score_streaks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  week_start DATE NOT NULL, -- semana en la que se detectó la 3ra (o más) semana consecutiva
  consecutive_weeks_below_50 INTEGER NOT NULL CHECK (consecutive_weeks_below_50 >= 3),
  scores JSONB NOT NULL DEFAULT '[]', -- [{week_start, total_score}, ...] de las semanas que componen la racha, para que el admin vea el detalle sin JOIN
  acknowledged BOOLEAN NOT NULL DEFAULT false,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE(employee_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_low_score_streaks_employee ON employee_low_score_streaks(employee_id);
CREATE INDEX IF NOT EXISTS idx_low_score_streaks_ack ON employee_low_score_streaks(acknowledged);

ALTER TABLE employee_low_score_streaks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Supervisors read low score streaks" ON employee_low_score_streaks;
CREATE POLICY "Supervisors read low score streaks" ON employee_low_score_streaks
  FOR SELECT USING (is_supervisor(auth.uid()));

DROP POLICY IF EXISTS "Supervisors insert low score streaks" ON employee_low_score_streaks;
CREATE POLICY "Supervisors insert low score streaks" ON employee_low_score_streaks
  FOR INSERT WITH CHECK (is_supervisor(auth.uid()));

DROP POLICY IF EXISTS "Supervisors update low score streaks" ON employee_low_score_streaks;
CREATE POLICY "Supervisors update low score streaks" ON employee_low_score_streaks
  FOR UPDATE USING (is_supervisor(auth.uid()));

DROP TRIGGER IF EXISTS trg_prevent_delete ON employee_low_score_streaks;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON employee_low_score_streaks
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

COMMENT ON TABLE employee_low_score_streaks IS
  'v8.3 E5: causal documentable de "<50 puntos x 3 semanas consecutivas" -- solo un registro visible al admin (bandeja + unified_alerts), nunca dispara suspensión/despido automático. Poblada por el cron weekly-scores tras cada recálculo.';

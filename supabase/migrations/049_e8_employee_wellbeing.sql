-- Migración 049 — v8.3 E8: checklist matutino, regla dura de bienestar +
-- riesgo químico, y modo "No estoy listo".
--
-- Principio de diseño (D.15 privacidad): la alerta de sueño debe llegar
-- AGREGADA y ser imposible de identificar desde el admin. Esto NO se aplica
-- solo en la capa de API — se bloquea a nivel de RLS: ningún rol, ni
-- siquiera owner_admin, puede hacer SELECT fila por fila de daily_checkins.
-- Solo existe una función SECURITY DEFINER que devuelve agregados.

-- ============================================================
-- 1. Checklist matutino
-- ============================================================
CREATE TABLE IF NOT EXISTS daily_checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  checkin_date DATE NOT NULL DEFAULT CURRENT_DATE,
  slept_6h_plus BOOLEAN,
  mood TEXT CHECK (mood IN ('happy', 'neutral', 'sad')),
  shortcut_accepted BOOLEAN NOT NULL DEFAULT false, -- atajo de ruta aceptado (+$10)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, checkin_date)
);

ALTER TABLE daily_checkins ENABLE ROW LEVEL SECURITY;

-- El empleado SOLO puede insertar/leer su propio checkin. Nadie mas
-- (ni owner_admin) tiene una politica de SELECT sobre esta tabla: a
-- proposito, para que sea imposible leer filas individuales desde el admin,
-- incluso por error humano en una query nueva.
DROP POLICY IF EXISTS "Employees manage own checkin" ON daily_checkins;
CREATE POLICY "Employees manage own checkin" ON daily_checkins
  FOR ALL USING (
    employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
  ) WITH CHECK (
    employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
  );

-- Función agregada: única forma de que el admin vea algo de esta tabla.
-- Nunca expone employee_id, nunca devuelve grupos de tamaño 1 (para que
-- un equipo de 1 persona activa no equivalga a identificar a alguien).
CREATE OR REPLACE FUNCTION get_wellbeing_aggregate(p_date DATE DEFAULT CURRENT_DATE)
RETURNS TABLE (
  checkin_date DATE,
  total_checkins INTEGER,
  slept_less_than_6h_count INTEGER,
  mood_happy_count INTEGER,
  mood_neutral_count INTEGER,
  mood_sad_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p_date,
    COUNT(*)::INTEGER,
    COUNT(*) FILTER (WHERE slept_6h_plus = false)::INTEGER,
    COUNT(*) FILTER (WHERE mood = 'happy')::INTEGER,
    COUNT(*) FILTER (WHERE mood = 'neutral')::INTEGER,
    COUNT(*) FILTER (WHERE mood = 'sad')::INTEGER
  FROM daily_checkins
  WHERE checkin_date = p_date;
END;
$$;

COMMENT ON FUNCTION get_wellbeing_aggregate IS
  'v8.3 E8: unico punto de lectura agregada de daily_checkins. La tabla en si no tiene politica de SELECT para admin — es imposible identificar individuos desde una query nueva por accidente.';

-- ============================================================
-- 2. Modo "No estoy listo" (readiness requests)
-- ============================================================
CREATE TABLE IF NOT EXISTS readiness_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id),
  request_type TEXT NOT NULL
    CHECK (request_type IN ('illness', 'family_emergency', 'no_transport')),
  notice_hours NUMERIC, -- horas de aviso antes del inicio de jornada
  request_date DATE NOT NULL DEFAULT CURRENT_DATE,
  resolution TEXT
    CHECK (resolution IN ('full_day_rate', 'reassigned', 'pickup_arranged', 'denied', 'pending')),
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_readiness_employee_date ON readiness_requests(employee_id, request_date);

ALTER TABLE readiness_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Employees manage own readiness requests" ON readiness_requests;
CREATE POLICY "Employees manage own readiness requests" ON readiness_requests
  FOR ALL USING (
    employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
  ) WITH CHECK (
    employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
  );
DROP POLICY IF EXISTS "Supervisors read readiness requests" ON readiness_requests;
CREATE POLICY "Supervisors read readiness requests" ON readiness_requests
  FOR SELECT USING (is_supervisor(auth.uid()));
DROP POLICY IF EXISTS "Supervisors update readiness requests" ON readiness_requests;
CREATE POLICY "Supervisors update readiness requests" ON readiness_requests
  FOR UPDATE USING (is_supervisor(auth.uid())) WITH CHECK (is_supervisor(auth.uid()));

DROP TRIGGER IF EXISTS trg_prevent_delete ON readiness_requests;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON readiness_requests
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

-- ============================================================
-- 3. Alertas de bienestar + riesgo quimico (timer 10 min)
-- ============================================================
CREATE TABLE IF NOT EXISTS wellbeing_chemical_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id),
  assignment_id UUID REFERENCES assignments(id),
  reported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  admin_responded_at TIMESTAMPTZ,
  auto_reassigned_at TIMESTAMPTZ,
  resolution TEXT
    CHECK (resolution IN ('admin_handled', 'auto_reassigned', 'pending')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wellbeing_alerts_pending
  ON wellbeing_chemical_alerts(reported_at)
  WHERE resolution = 'pending' OR resolution IS NULL;

ALTER TABLE wellbeing_chemical_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Employees insert own chemical alert" ON wellbeing_chemical_alerts;
CREATE POLICY "Employees insert own chemical alert" ON wellbeing_chemical_alerts
  FOR INSERT WITH CHECK (
    employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
  );
DROP POLICY IF EXISTS "Supervisors manage chemical alerts" ON wellbeing_chemical_alerts;
CREATE POLICY "Supervisors manage chemical alerts" ON wellbeing_chemical_alerts
  FOR ALL USING (is_supervisor(auth.uid())) WITH CHECK (is_supervisor(auth.uid()));

DROP TRIGGER IF EXISTS trg_prevent_delete ON wellbeing_chemical_alerts;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON wellbeing_chemical_alerts
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

-- Recursos RBAC nuevos: bienestar se administra igual que operacion.
-- (admin-rbac.ts se actualiza en el mismo commit de esta migracion)

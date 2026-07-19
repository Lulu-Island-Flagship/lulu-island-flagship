-- Migración 188 — v8.3 E8: fixes de auditoría (Empleado: preparación y
-- comunidad). Tres piezas independientes que faltaban:
--
-- 1. wellbeing_opt_out: un empleado puede excluirse de los agregados de
--    ánimo/sueño (get_wellbeing_aggregate) y de cualquier futuro ranking
--    derivado de esos datos. No existía ningún mecanismo de opt-out --
--    daily_checkins es opcional para llenar, pero una vez llenado no había
--    forma de que un empleado dijera "no quiero que mis respuestas cuenten
--    ni siquiera en el agregado". get_wellbeing_aggregate ahora filtra por
--    esta columna vía join a employees.
--
--    Nota de alcance: el ranking de EQUIPOS (team_weekly_scores, migración
--    099) no tiene columna de empleado -- es estructuralmente imposible que
--    una fila individual "entre" a esa tabla, así que no hay nada que
--    filtrar ahí a nivel de esta migración. Si en el futuro el cálculo que
--    alimenta team_weekly_scores usa datos individuales, ESE cálculo deberá
--    respetar employees.wellbeing_opt_out en el momento de agregar.
--
-- 2. employee_wellbeing_bonuses: pago real de la racha de 5 días de
--    checklist matutino (+$5), espejo de employee_badge_bonuses (migración
--    136) para que payroll-export lo pueda fusionar igual. También sirve
--    para el bono de atajo de ruta validado (+$10, ver route_shortcuts).
--    checkin/page.tsx prometía estos bonos con cero lógica de backend --
--    ver comentario en src/lib/wellbeing-bonus.ts para la lógica de racha.
--
-- 3. route_shortcuts: "ruta con aprendizaje" (spec E8) -- un empleado
--    reporta un atajo real que descubrió en campo; un supervisor lo valida
--    (y ahí sí se paga el bono de $10 vía employee_wellbeing_bonuses,
--    separado del checkbox diario shortcut_accepted de daily_checkins, que
--    vive en una tabla sin SELECT admin por diseño de privacidad -- ver
--    049_e8_employee_wellbeing.sql). uses_count deja rastro de cuántas
--    veces se ha usado ese atajo reportado.

-- ============================================================
-- 1. Opt-out de bienestar
-- ============================================================
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS wellbeing_opt_out BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN employees.wellbeing_opt_out IS
  'v8.3 E8 FIX-2: si es true, este empleado se excluye de get_wellbeing_aggregate() y de cualquier agregado de ánimo/sueño derivado. Lo controla el propio empleado (mismo self-update de employees que ya existe desde 003/181), nunca un admin en su nombre.';

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
    COUNT(*) FILTER (WHERE dc.slept_6h_plus = false)::INTEGER,
    COUNT(*) FILTER (WHERE dc.mood = 'happy')::INTEGER,
    COUNT(*) FILTER (WHERE dc.mood = 'neutral')::INTEGER,
    COUNT(*) FILTER (WHERE dc.mood = 'sad')::INTEGER
  FROM daily_checkins dc
  JOIN employees e ON e.id = dc.employee_id
  WHERE dc.checkin_date = p_date
    AND e.wellbeing_opt_out = false;
END;
$$;

COMMENT ON FUNCTION get_wellbeing_aggregate IS
  'v8.3 E8 FIX-2: único punto de lectura agregada de daily_checkins, ahora excluye empleados con wellbeing_opt_out = true. La tabla en sí sigue sin política de SELECT para admin.';

-- ============================================================
-- 2. Bonos de bienestar reales (racha de checklist + atajo validado)
-- ============================================================
CREATE TABLE IF NOT EXISTS employee_wellbeing_bonuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('checkin_streak_5day', 'shortcut_validated')),
  bonus_cents INTEGER NOT NULL CHECK (bonus_cents >= 0),
  credit_date DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  -- Una racha de 5 días solo puede pagarse una vez por fecha de corte de
  -- racha (evita doble pago si el endpoint se llama dos veces el mismo día).
  CONSTRAINT employee_wellbeing_bonuses_unique_streak UNIQUE (employee_id, source, credit_date)
);

CREATE INDEX IF NOT EXISTS idx_employee_wellbeing_bonuses_employee ON employee_wellbeing_bonuses(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_wellbeing_bonuses_credit_date ON employee_wellbeing_bonuses(credit_date);

ALTER TABLE employee_wellbeing_bonuses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Employees read own wellbeing bonuses" ON employee_wellbeing_bonuses;
CREATE POLICY "Employees read own wellbeing bonuses" ON employee_wellbeing_bonuses
  FOR SELECT USING (employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid()));

-- Igual que employee_badge_bonuses: solo owner_admin administra dinero, y
-- de todas formas la escritura real ocurre vía service-role en los
-- endpoints (checkin streak es automático; shortcut_validated lo dispara
-- un supervisor validando un route_shortcuts).
DROP POLICY IF EXISTS "owner_admin manages wellbeing bonuses" ON employee_wellbeing_bonuses;
CREATE POLICY "owner_admin manages wellbeing bonuses" ON employee_wellbeing_bonuses
  FOR ALL USING (has_admin_role(auth.uid(), ARRAY['owner_admin']))
  WITH CHECK (has_admin_role(auth.uid(), ARRAY['owner_admin']));

DROP TRIGGER IF EXISTS trg_prevent_delete ON employee_wellbeing_bonuses;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON employee_wellbeing_bonuses
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

-- ============================================================
-- 3. "Ruta con aprendizaje": atajos reportados por empleados
-- ============================================================
CREATE TABLE IF NOT EXISTS route_shortcuts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  uses_count INTEGER NOT NULL DEFAULT 1 CHECK (uses_count >= 0),
  reported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  validated_at TIMESTAMPTZ,
  validated_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_route_shortcuts_employee ON route_shortcuts(employee_id);
CREATE INDEX IF NOT EXISTS idx_route_shortcuts_pending ON route_shortcuts(reported_at) WHERE validated_at IS NULL;

ALTER TABLE route_shortcuts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Employees manage own route shortcuts" ON route_shortcuts;
CREATE POLICY "Employees manage own route shortcuts" ON route_shortcuts
  FOR ALL USING (
    employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
  ) WITH CHECK (
    employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Supervisors read route shortcuts" ON route_shortcuts;
CREATE POLICY "Supervisors read route shortcuts" ON route_shortcuts
  FOR SELECT USING (is_supervisor(auth.uid()));

DROP POLICY IF EXISTS "Supervisors validate route shortcuts" ON route_shortcuts;
CREATE POLICY "Supervisors validate route shortcuts" ON route_shortcuts
  FOR UPDATE USING (is_supervisor(auth.uid())) WITH CHECK (is_supervisor(auth.uid()));

DROP TRIGGER IF EXISTS trg_prevent_delete ON route_shortcuts;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON route_shortcuts
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

COMMENT ON TABLE route_shortcuts IS
  'v8.3 E8 FIX-4: "ruta con aprendizaje" -- un empleado reporta un atajo real; un supervisor lo valida (validated_at/validated_by) y eso dispara el bono de $10 vía employee_wellbeing_bonuses(source=shortcut_validated). Separado a propósito de daily_checkins.shortcut_accepted, que vive en una tabla sin SELECT admin por privacidad.';

-- Migración 136 — v8.3 E8 (D.11): insignias con bono real + ruta de carrera.
--
-- Contexto: D.11 define 7 insignias y 5 niveles de carrera. Nada de esto
-- existía -- ni siquiera una columna de nivel en employees. Diseño en 3
-- piezas:
--
-- 1. employee_badges: registro INMUTABLE de insignias ganadas (mismo patrón
--    que team_weekly_scores -- prevent_hard_delete, nunca se corrige con
--    UPDATE/DELETE). UNIQUE(employee_id, badge_key, period_key) para que una
--    insignia recurrente (ej. Ascenso, que se re-evalúa) no se duplique en
--    el mismo período, y una insignia de una sola vez (period_key = NULL)
--    literalmente no pueda otorgarse dos veces a la misma persona.
--
-- 2. employee_badge_bonuses: el bono en dólares que esa insignia trae. Tabla
--    SEPARADA de employee_badges (no fusionada) siguiendo el patrón ya
--    probado de payroll_readiness_credits (migración 090, commit 6a5b299):
--    /api/admin/payroll-export ya sabe fusionar créditos no ligados a una
--    orden específica al ciclo quincenal real vía aggregateCycle() sin tocar
--    payroll-cycle.ts. Esta tabla se fusiona exactamente igual.
--
-- 3. employees.career_level: nivel de carrera (D.11). Los ascensos a
--    Líder/Líder Mentor/Coordinador EXIGEN certificación + recomendación +
--    aprobación admin (datos que hoy no existen en el sistema -- no hay
--    tabla de certificaciones) -- por diseño, esta columna NUNCA se mueve
--    sola: solo un PATCH admin explícito la cambia (ver
--    /api/admin/empleados/[id]/career-level). El sistema solo calcula
--    ELEGIBILIDAD (función pura en src/lib/career-path.ts), nunca ejecuta
--    el ascenso.

CREATE TABLE IF NOT EXISTS employee_badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  badge_key TEXT NOT NULL CHECK (badge_key IN (
    'service_gold', 'eco_warrior', 'detail_master', 'flash',
    'team_player', 'guardian', 'promotion_ready'
  )),
  -- '1970-01-01' (sentinel, NUNCA NULL -- un UNIQUE estándar trata NULL
  -- como distinto en cada fila, lo que permitiría otorgar una insignia de
  -- una sola vez infinitas veces) para insignias de una sola vez (ej.
  -- service_gold); YYYY-MM-DD del lunes de la semana para insignias que se
  -- re-evalúan periódicamente (ej. promotion_ready, 4 semanas consecutivas).
  period_key DATE NOT NULL DEFAULT '1970-01-01',
  earned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Contexto legible de por qué se otorgó (ej. "52 servicios sin disputa"),
  -- para que el admin nunca tenga que adivinar el cálculo desde cero.
  evidence TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT employee_badges_unique_period UNIQUE (employee_id, badge_key, period_key)
);

CREATE INDEX IF NOT EXISTS idx_employee_badges_employee ON employee_badges(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_badges_key ON employee_badges(badge_key);

ALTER TABLE employee_badges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Employees read own badges" ON employee_badges;
CREATE POLICY "Employees read own badges" ON employee_badges
  FOR SELECT USING (employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "admins manage employee badges" ON employee_badges;
CREATE POLICY "admins manage employee badges" ON employee_badges
  FOR ALL USING (has_admin_role(auth.uid(), ARRAY['owner_admin','ops_coordinator']))
  WITH CHECK (has_admin_role(auth.uid(), ARRAY['owner_admin','ops_coordinator']));

DROP TRIGGER IF EXISTS trg_prevent_delete ON employee_badges;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON employee_badges
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

-- ============================================================
-- Bono en dólares de cada insignia ganada. Espejo exacto de
-- payroll_readiness_credits (090) para que payroll-export lo funda al
-- ciclo real de la misma forma ya probada.
-- ============================================================
CREATE TABLE IF NOT EXISTS employee_badge_bonuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  employee_badge_id UUID NOT NULL REFERENCES employee_badges(id) ON DELETE CASCADE,
  bonus_cents INTEGER NOT NULL CHECK (bonus_cents >= 0),
  -- Fecha con la que este bono entra al ciclo quincenal (= earned_at::date
  -- de la insignia, en hora Vancouver -- se guarda desnormalizado para que
  -- payroll-export no tenga que hacer join extra).
  credit_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_employee_badge_bonuses_employee ON employee_badge_bonuses(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_badge_bonuses_credit_date ON employee_badge_bonuses(credit_date);

ALTER TABLE employee_badge_bonuses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_admin manages badge bonuses" ON employee_badge_bonuses;
CREATE POLICY "owner_admin manages badge bonuses" ON employee_badge_bonuses
  FOR ALL USING (has_admin_role(auth.uid(), ARRAY['owner_admin']))
  WITH CHECK (has_admin_role(auth.uid(), ARRAY['owner_admin']));

-- El empleado puede VER (nunca editar) el bono en dólares de sus propias
-- insignias -- es información que le pertenece, igual que su propio score.
DROP POLICY IF EXISTS "Employees read own badge bonuses" ON employee_badge_bonuses;
CREATE POLICY "Employees read own badge bonuses" ON employee_badge_bonuses
  FOR SELECT USING (employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid()));

-- ============================================================
-- Ruta de carrera (D.11). Ver nota de diseño arriba: el sistema NUNCA
-- mueve career_level solo; solo un admin lo cambia explícitamente.
-- ============================================================
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS career_level TEXT NOT NULL DEFAULT 'trabajador'
    CHECK (career_level IN ('trabajador', 'senior', 'lider', 'lider_mentor', 'coordinador_operativo')),
  ADD COLUMN IF NOT EXISTS career_level_since TIMESTAMPTZ NOT NULL DEFAULT now();

COMMENT ON COLUMN employees.career_level IS
  'v8.3 D.11: Trabajador -> Senior -> Líder -> Líder Mentor -> Coordinador operativo. Cambiado SOLO por PATCH admin explícito (requiere certificación + recomendación humana que el sistema no puede verificar solo). El sistema únicamente calcula elegibilidad (src/lib/career-path.ts), nunca promueve.';

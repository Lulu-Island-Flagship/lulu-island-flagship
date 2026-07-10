-- Migración 099 — v8.3 E8 (D.8.10, B.2.21): ranking semanal de equipos.
-- Regla dura B.2.21: "Prohibido el ranking individual de empleados. Solo
-- equipos, solo Top 3, semanal." Estructuralmente: ninguna tabla de este
-- archivo tiene columna de empleado individual, y la única función de
-- lectura pensada para el ranking (get_team_top3) trunca a 3 filas y solo
-- proyecta columnas de equipo. Mismo patrón que get_wellbeing_aggregate
-- (049_e8_employee_wellbeing.sql): la agregación vive en la base de datos,
-- no confía en que la capa de aplicación filtre correctamente.

-- ============================================================
-- 1. Identidad mínima de equipo (spec E8.9: nombre propio con aprobación
--    admin, avatar de iniciales+color — sin fotos). Solo lo necesario para
--    que team_weekly_scores tenga a qué apuntar; el resto de identidad de
--    equipo (chat interno, rotación, insignias) queda fuera de esta tanda.
-- ============================================================
CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  avatar_initials TEXT,
  avatar_color TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_teams_active ON teams(active) WHERE deleted_at IS NULL;

ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins manage teams" ON teams;
CREATE POLICY "admins manage teams" ON teams
  FOR ALL USING (has_admin_role(auth.uid(), ARRAY['owner_admin','ops_coordinator']))
  WITH CHECK (has_admin_role(auth.uid(), ARRAY['owner_admin','ops_coordinator']));

DROP TRIGGER IF EXISTS trg_prevent_delete ON teams;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON teams
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

-- ============================================================
-- 2. Scores semanales AGREGADOS POR EQUIPO. Una fila = un equipo, una
--    semana. NO existe (ni puede existir sin una migración nueva) una
--    columna de empleado aquí — el desglose individual que alimenta estos
--    4 números vive, si acaso, en otra tabla operativa fuera de este
--    módulo; team_weekly_scores solo recibe el agregado ya calculado.
-- ============================================================
CREATE TABLE IF NOT EXISTS team_weekly_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  efficiency_score NUMERIC(5,2) NOT NULL CHECK (efficiency_score BETWEEN 0 AND 100),
  quality_score NUMERIC(5,2) NOT NULL CHECK (quality_score BETWEEN 0 AND 100),
  punctuality_score NUMERIC(5,2) NOT NULL CHECK (punctuality_score BETWEEN 0 AND 100),
  commercial_score NUMERIC(5,2) NOT NULL CHECK (commercial_score BETWEEN 0 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT team_weekly_scores_monday CHECK (EXTRACT(DOW FROM week_start) = 1),
  CONSTRAINT team_weekly_scores_unique_team_week UNIQUE (team_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_team_weekly_scores_week ON team_weekly_scores(week_start);

ALTER TABLE team_weekly_scores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins manage team weekly scores" ON team_weekly_scores;
CREATE POLICY "admins manage team weekly scores" ON team_weekly_scores
  FOR ALL USING (has_admin_role(auth.uid(), ARRAY['owner_admin','ops_coordinator']))
  WITH CHECK (has_admin_role(auth.uid(), ARRAY['owner_admin','ops_coordinator']));

-- Historial inmutable, igual que competitor_snapshots: nunca se corrige un
-- score pasado con UPDATE/DELETE, se inserta una fila nueva si aplica.
DROP TRIGGER IF EXISTS trg_prevent_delete ON team_weekly_scores;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON team_weekly_scores
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

-- ============================================================
-- 3. get_team_top3(): ÚNICA función pensada para leer el ranking. Aplica
--    los mismos pesos que src/lib/team-ranking.ts (40/30/20/10, spec E8.10)
--    y SIEMPRE trunca a 3 filas — la API nunca debe pedir "todos los
--    equipos ordenados" y truncar del lado del cliente, porque eso deja una
--    ruta donde alguien podría exponer posiciones 4+ por error. La función
--    solo proyecta team_id/team_name/composite_score: no hay forma de que
--    devuelva un dato individual porque team_weekly_scores no lo tiene.
-- ============================================================
CREATE OR REPLACE FUNCTION get_team_top3(p_week_start DATE)
RETURNS TABLE(team_id UUID, team_name TEXT, composite_score NUMERIC)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id AS team_id,
    t.name AS team_name,
    ROUND(
      s.efficiency_score * 0.4 +
      s.quality_score * 0.3 +
      s.punctuality_score * 0.2 +
      s.commercial_score * 0.1
    , 2) AS composite_score
  FROM team_weekly_scores s
  JOIN teams t ON t.id = s.team_id AND t.deleted_at IS NULL
  WHERE s.week_start = p_week_start
  ORDER BY composite_score DESC, t.name ASC
  LIMIT 3;
$$;

COMMENT ON TABLE teams IS
  'v8.3 E8: identidad mínima de equipo (nombre + avatar iniciales/color). Sin fotos, sin datos individuales.';
COMMENT ON TABLE team_weekly_scores IS
  'v8.3 E8 (B.2.21): scores semanales agregados POR EQUIPO. Nunca lleva columna de empleado — regla dura, no solo convención de UI.';
COMMENT ON FUNCTION get_team_top3 IS
  'v8.3 E8 (B.2.21): única vía soportada para leer el ranking. Trunca a 3 filas siempre; no expone posiciones inferiores. Mismo patrón que get_wellbeing_aggregate.';

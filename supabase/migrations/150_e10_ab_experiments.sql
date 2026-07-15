-- Migración 150 — v8.3 E10 (D.10.11): motor de experimentación A/B. La
-- lógica pura (src/lib/ab-experiments.ts: validateVariantWeights,
-- assignVariant, evaluateExperimentWinner — 100% testeada) existía sin
-- ninguna tabla ni ruta que la usara.
--
-- Nota de alcance: esta migración + sus rutas conectan el motor de
-- asignación/evaluación de extremo a extremo (bitácora inmutable real,
-- exclusión dura de recurrentes, ganador calculado nunca a mano). NO
-- modifica el motor de precios/cotizador para inyectar variantes en vivo --
-- eso requeriría tocar rules.ts/pricing.ts, que es una decisión de diseño
-- más grande. El admin puede crear experimentos y asignar/evaluar clientes
-- reales desde ya; conectar una variante de PRECIO real al cotizador queda
-- como siguiente paso explícito, no inventado aquí.

CREATE TABLE IF NOT EXISTS experiments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  experiment_type TEXT NOT NULL CHECK (experiment_type IN ('price', 'copy', 'ui_ux', 'batch_schedule')),
  -- [{ name: 'control', weight: 0.9 }, { name: 'variant_a', weight: 0.1 }, ...]
  -- variants[0] es SIEMPRE el control (invariante de assignVariant()).
  variants JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'running', 'completed')),
  winner TEXT,
  winner_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

ALTER TABLE experiments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner manages experiments" ON experiments;
CREATE POLICY "Owner manages experiments" ON experiments
  FOR ALL USING (has_admin_role(auth.uid(), ARRAY['owner_admin']))
  WITH CHECK (has_admin_role(auth.uid(), ARRAY['owner_admin']));

DROP TRIGGER IF EXISTS trg_prevent_delete ON experiments;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON experiments
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

-- Bitácora INMUTABLE de qué variante vio cada cliente (regla dura del spec:
-- "log inmutable de qué variante vio cada cliente"). Un cliente nunca
-- cambia de variante una vez asignado -- ni el admin puede editarlo, solo
-- existe.
CREATE TABLE IF NOT EXISTS experiment_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id UUID NOT NULL REFERENCES experiments(id),
  client_user_id UUID NOT NULL REFERENCES auth.users(id),
  variant TEXT, -- NULL = excluido (ej. cliente recurrente protegido)
  excluded_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT experiment_assignments_unique_client UNIQUE (experiment_id, client_user_id)
);

CREATE INDEX IF NOT EXISTS idx_experiment_assignments_experiment ON experiment_assignments(experiment_id);

ALTER TABLE experiment_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner reads experiment assignments" ON experiment_assignments;
CREATE POLICY "Owner reads experiment assignments" ON experiment_assignments
  FOR SELECT USING (has_admin_role(auth.uid(), ARRAY['owner_admin']));

DROP POLICY IF EXISTS "Owner inserts experiment assignments" ON experiment_assignments;
CREATE POLICY "Owner inserts experiment assignments" ON experiment_assignments
  FOR INSERT WITH CHECK (has_admin_role(auth.uid(), ARRAY['owner_admin']));

DROP TRIGGER IF EXISTS trg_prevent_delete ON experiment_assignments;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON experiment_assignments
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

CREATE OR REPLACE FUNCTION prevent_experiment_assignment_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'experiment_assignments es un registro inmutable -- un cliente nunca cambia de variante'
    USING ERRCODE = 'raise_exception';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_update ON experiment_assignments;
CREATE TRIGGER trg_prevent_update BEFORE UPDATE ON experiment_assignments
  FOR EACH ROW EXECUTE FUNCTION prevent_experiment_assignment_update();

COMMENT ON TABLE experiment_assignments IS
  'v8.3 E10 D.10.11: bitácora inmutable de asignación de variante por cliente (assignVariant en src/lib/ab-experiments.ts). Clientes recurrentes siempre variant=NULL con excluded_reason.';

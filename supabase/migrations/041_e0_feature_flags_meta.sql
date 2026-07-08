-- ============================================================
-- E0 RETROFIT — Criterio 4: metadatos del panel de feature flags
-- (wireframe aprobado por el dueño 2026-07-08)
-- ============================================================

ALTER TABLE feature_flags ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE feature_flags ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
-- es_critico: flags P0 (dinero/operación central) — el panel muestra banner si llevan >7 días apagados
ALTER TABLE feature_flags ADD COLUMN IF NOT EXISTS es_critico BOOLEAN NOT NULL DEFAULT false;

UPDATE feature_flags SET es_critico = true
WHERE nombre IN ('cotizador_v8', 'batch_capture_enabled', 'hold_t72_enabled', 'payroll_enabled', 'dispatch_enabled');

CREATE OR REPLACE FUNCTION touch_feature_flag()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_feature_flag ON feature_flags;
CREATE TRIGGER trg_touch_feature_flag BEFORE UPDATE ON feature_flags
  FOR EACH ROW EXECUTE FUNCTION touch_feature_flag();

-- RLS: lectura para roles admin; escritura SOLO owner_admin
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read flags" ON feature_flags;
CREATE POLICY "admins read flags" ON feature_flags
  FOR SELECT USING (
    has_admin_role(auth.uid(), ARRAY['owner_admin','ops_coordinator','qc_only'])
    OR is_supervisor(auth.uid())
  );

DROP POLICY IF EXISTS "owner updates flags" ON feature_flags;
CREATE POLICY "owner updates flags" ON feature_flags
  FOR UPDATE USING (has_admin_role(auth.uid(), ARRAY['owner_admin']));

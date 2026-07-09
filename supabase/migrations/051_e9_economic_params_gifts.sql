-- Migración 051 — v8.3 E9: parámetros económicos (Day Rate mínimo) y
-- programa de regalos por retención.

-- ============================================================
-- 1. Día Rate mínimo en payroll_settings (falta junto al salario/hora)
-- ============================================================
ALTER TABLE payroll_settings
  ADD COLUMN IF NOT EXISTS minimum_day_rate NUMERIC(10,2) NOT NULL DEFAULT 146.00,
  ADD COLUMN IF NOT EXISTS standard_day_hours NUMERIC(4,1) NOT NULL DEFAULT 8.0;

-- payroll_settings ya tiene el trigger de snapshot obligatorio (migracion 042)
-- aplicado — cualquier cambio aqui exige app.change_reason. No se repite.

-- ============================================================
-- 2. Salud del feed legal (D.9.7): un registro por ente monitoreado
-- ============================================================
CREATE TABLE IF NOT EXISTS legal_feed_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_name TEXT NOT NULL UNIQUE, -- 'employment_standards', 'cra', 'worksafebc', 'bc_environment', 'pipeda_oipc', 'casl', 'icbc'
  last_updated_at TIMESTAMPTZ,
  check_frequency TEXT NOT NULL
    CHECK (check_frequency IN ('daily', 'weekly', 'monthly')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE legal_feed_status ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Supervisors manage legal feed status" ON legal_feed_status;
CREATE POLICY "Supervisors manage legal feed status" ON legal_feed_status
  FOR ALL USING (is_supervisor(auth.uid())) WITH CHECK (is_supervisor(auth.uid()));

INSERT INTO legal_feed_status (entity_name, check_frequency) VALUES
  ('employment_standards', 'daily'),
  ('cra', 'weekly'),
  ('worksafebc', 'weekly'),
  ('bc_environment', 'monthly'),
  ('pipeda_oipc', 'monthly'),
  ('casl', 'monthly'),
  ('icbc', 'monthly')
ON CONFLICT (entity_name) DO NOTHING;

-- ============================================================
-- 3. Programa de regalos por retencion (D.9.11)
-- ============================================================
CREATE TABLE IF NOT EXISTS retention_gifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_user_id UUID NOT NULL,
  months_active INTEGER NOT NULL,
  first_year_value_cents INTEGER NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('tier1', 'tier2', 'tier3')),
  suggested_gift_cents INTEGER NOT NULL,
  requires_manual_approval BOOLEAN NOT NULL DEFAULT false,
  approved_by UUID REFERENCES employees(id),
  approved_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_retention_gifts_client ON retention_gifts(client_user_id);

ALTER TABLE retention_gifts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Supervisors manage retention gifts" ON retention_gifts;
CREATE POLICY "Supervisors manage retention gifts" ON retention_gifts
  FOR ALL USING (is_supervisor(auth.uid())) WITH CHECK (is_supervisor(auth.uid()));

DROP TRIGGER IF EXISTS trg_prevent_delete ON retention_gifts;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON retention_gifts
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

-- Beneficios a property managers: SOLO las dos vias validas del spec.
-- Ningun registro puede describirse como regalo personal (riesgo penal s.426).
CREATE TABLE IF NOT EXISTS property_manager_benefits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_manager_user_id UUID NOT NULL,
  benefit_type TEXT NOT NULL
    CHECK (benefit_type IN ('transparent_building_benefit', 'declared_partnership_commission')),
  description TEXT NOT NULL,
  requires_t4a BOOLEAN NOT NULL DEFAULT true,
  amount_cents INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

ALTER TABLE property_manager_benefits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Supervisors manage PM benefits" ON property_manager_benefits;
CREATE POLICY "Supervisors manage PM benefits" ON property_manager_benefits
  FOR ALL USING (is_supervisor(auth.uid())) WITH CHECK (is_supervisor(auth.uid()));

DROP TRIGGER IF EXISTS trg_prevent_delete ON property_manager_benefits;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON property_manager_benefits
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

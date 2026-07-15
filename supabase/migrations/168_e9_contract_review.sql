-- Migración 168 — v8.3 E9.8: "Revisión automática de contratos: 60 días
-- antes del vencimiento → diff de cambios legales vs. contrato →
-- aprobación → firma digital → versión anterior 'superseded'."

-- ============================================================
-- 1. Revisiones disparadas (una por contrato por ciclo de aniversario)
-- ============================================================
CREATE TABLE IF NOT EXISTS contract_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES service_contracts(id) ON DELETE CASCADE,
  trigger_date DATE NOT NULL,
  anniversary_date DATE NOT NULL,
  legal_changes_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'signed', 'dismissed')),
  proposed_terms JSONB,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  dismissal_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contract_id, anniversary_date)
);

CREATE INDEX IF NOT EXISTS idx_contract_reviews_contract ON contract_reviews(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_reviews_status ON contract_reviews(status);

ALTER TABLE contract_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Supervisors manage contract reviews" ON contract_reviews;
CREATE POLICY "Supervisors manage contract reviews" ON contract_reviews
  FOR ALL USING (is_supervisor(auth.uid()));

DROP POLICY IF EXISTS "Clients read own contract reviews" ON contract_reviews;
CREATE POLICY "Clients read own contract reviews" ON contract_reviews
  FOR SELECT USING (
    contract_id IN (SELECT id FROM service_contracts WHERE user_id = auth.uid())
  );

COMMENT ON TABLE contract_reviews IS
  'v8.3 E9.8: revisión de contrato disparada 60 días antes del aniversario anual, con el resumen de cambios legales detectados (legal_change_alerts, E9.7) desde la última revisión. src/lib/contract-review.ts decide cuándo dispara y arma el diff.';

-- ============================================================
-- 2. Versiones firmadas del contrato (historial inmutable, "superseded")
-- ============================================================
CREATE TABLE IF NOT EXISTS contract_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES service_contracts(id) ON DELETE CASCADE,
  review_id UUID REFERENCES contract_reviews(id) ON DELETE SET NULL,
  version_number INTEGER NOT NULL,
  terms_snapshot JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded')),
  -- "Firma digital": clickwrap (nombre escrito + IP + timestamp), mismo
  -- espíritu que quotes.consent_tc/consent_ip/consent_accepted_at
  -- (migración 001) -- no hay integración real con Documenso/DocuSign en
  -- este entorno (sin credenciales de esa cuenta).
  signed_by_name TEXT,
  signed_ip TEXT,
  signed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contract_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_contract_versions_contract ON contract_versions(contract_id);

-- Inmutable: es el historial legal del contrato.
DROP TRIGGER IF EXISTS trg_prevent_delete ON contract_versions;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON contract_versions
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

ALTER TABLE contract_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Supervisors manage contract versions" ON contract_versions;
CREATE POLICY "Supervisors manage contract versions" ON contract_versions
  FOR ALL USING (is_supervisor(auth.uid()));

DROP POLICY IF EXISTS "Clients read own contract versions" ON contract_versions;
CREATE POLICY "Clients read own contract versions" ON contract_versions
  FOR SELECT USING (
    contract_id IN (SELECT id FROM service_contracts WHERE user_id = auth.uid())
  );

COMMENT ON TABLE contract_versions IS
  'v8.3 E9.8: historial versionado del contrato. Al firmar una nueva versión, la anterior pasa a status=superseded -- nunca se borra (trigger prevent_hard_delete).';

-- Migración Módulo 2 — PayPal primer servicio + Garantía fotográfica

-- ============================================================
-- 1. Extender orders para PayPal y estado de garantía
-- ============================================================
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS paypal_transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS paypal_payer_email TEXT,
  ADD COLUMN IF NOT EXISTS warranty_status TEXT DEFAULT 'none'
    CHECK (warranty_status IN ('none', 'open', 'resolved_client', 'resolved_lulu', 'escalated')),
  ADD COLUMN IF NOT EXISTS warranty_resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS warranty_resolution_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_paypal_txn ON orders(paypal_transaction_id)
  WHERE paypal_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_warranty_status ON orders(warranty_status)
  WHERE warranty_status <> 'none';

-- ============================================================
-- 2. Tabla de reclamos de garantía
-- ============================================================
CREATE TABLE IF NOT EXISTS warranty_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'resolved_client', 'resolved_lulu', 'escalated', 'dismissed')),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resolution_notes TEXT,
  auto_resolved BOOLEAN NOT NULL DEFAULT false,
  refund_amount INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_warranty_claims_order ON warranty_claims(order_id);
CREATE INDEX IF NOT EXISTS idx_warranty_claims_user ON warranty_claims(user_id);
CREATE INDEX IF NOT EXISTS idx_warranty_claims_status ON warranty_claims(status);

ALTER TABLE warranty_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Clients read own warranty claims" ON warranty_claims;
CREATE POLICY "Clients read own warranty claims" ON warranty_claims
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Clients insert own warranty claims" ON warranty_claims;
CREATE POLICY "Clients insert own warranty claims" ON warranty_claims
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Supervisors read all warranty claims" ON warranty_claims;
CREATE POLICY "Supervisors read all warranty claims" ON warranty_claims
  FOR SELECT USING (is_supervisor(auth.uid()));

DROP POLICY IF EXISTS "Supervisors update warranty claims" ON warranty_claims;
CREATE POLICY "Supervisors update warranty claims" ON warranty_claims
  FOR UPDATE USING (is_supervisor(auth.uid()));

-- ============================================================
-- 3. Tabla de evidencia fotográfica vinculada a garantía
-- ============================================================
CREATE TABLE IF NOT EXISTS warranty_photo_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warranty_claim_id UUID NOT NULL REFERENCES warranty_claims(id) ON DELETE CASCADE,
  service_checklist_item_id UUID REFERENCES service_checklist_items(id) ON DELETE SET NULL,
  photo_url TEXT NOT NULL,
  photo_type TEXT NOT NULL CHECK (photo_type IN ('before', 'after', 'client')),
  zone TEXT,
  item_label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_warranty_photo_evidence_claim ON warranty_photo_evidence(warranty_claim_id);

ALTER TABLE warranty_photo_evidence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Clients read own warranty evidence" ON warranty_photo_evidence;
CREATE POLICY "Clients read own warranty evidence" ON warranty_photo_evidence
  FOR SELECT USING (
    warranty_claim_id IN (SELECT id FROM warranty_claims WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Supervisors read all warranty evidence" ON warranty_photo_evidence;
CREATE POLICY "Supervisors read all warranty evidence" ON warranty_photo_evidence
  FOR SELECT USING (is_supervisor(auth.uid()));

DROP POLICY IF EXISTS "Supervisors insert warranty evidence" ON warranty_photo_evidence;
CREATE POLICY "Supervisors insert warranty evidence" ON warranty_photo_evidence
  FOR INSERT WITH CHECK (is_supervisor(auth.uid()));

-- ============================================================
-- 4. Feature flags
-- ============================================================
INSERT INTO feature_flags (nombre, activo, modulo, descripcion)
VALUES ('paypal_first_service_enabled', false, 'Módulo 2', 'Permitir PayPal solo para primer servicio')
ON CONFLICT (nombre) DO UPDATE SET activo = false;

INSERT INTO feature_flags (nombre, activo, modulo, descripcion)
VALUES ('warranty_photo_enabled', true, 'Módulo 2', 'Garantía relacional con evidencia fotográfica')
ON CONFLICT (nombre) DO UPDATE SET activo = true;

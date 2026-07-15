-- Migración 147 — v8.3 E10 (D.10.6): comisiones de partners. La lógica pura
-- (calculatePartnerCommission en src/lib/partner-commissions.ts, 100%
-- testeada) existía sin ninguna tabla ni ruta que la usara: no había registro
-- de partners ni de comisiones generadas. Property managers NUNCA reciben
-- regalo personal oculto (riesgo penal s.426, invariante E9.11) -- por eso
-- requires_t4a es siempre true y no editable por la aplicación.

CREATE TABLE IF NOT EXISTS partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_type TEXT NOT NULL CHECK (partner_type IN (
    'real_estate_agent', 'property_manager', 'veterinarian', 'builder'
  )),
  name TEXT NOT NULL,
  contact_email TEXT,
  contact_phone TEXT,
  -- Requerido antes del primer pago real (T4A obligatorio, CRA) pero no al
  -- registrar el partner -- se puede anotar el partner primero y completar
  -- el dato fiscal antes de aprobar el primer pago.
  tax_id_for_t4a TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_partners_type ON partners(partner_type);

ALTER TABLE partners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner manages partners" ON partners;
CREATE POLICY "Owner manages partners" ON partners
  FOR ALL USING (has_admin_role(auth.uid(), ARRAY['owner_admin']))
  WITH CHECK (has_admin_role(auth.uid(), ARRAY['owner_admin']));

DROP TRIGGER IF EXISTS trg_prevent_delete ON partners;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON partners
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

CREATE TABLE IF NOT EXISTS partner_commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID NOT NULL REFERENCES partners(id),
  order_id UUID REFERENCES orders(id),
  order_value_cents INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  requires_t4a BOOLEAN NOT NULL DEFAULT true,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'void')),
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_partner_commissions_partner ON partner_commissions(partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_commissions_status ON partner_commissions(status);

ALTER TABLE partner_commissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner manages partner commissions" ON partner_commissions;
CREATE POLICY "Owner manages partner commissions" ON partner_commissions
  FOR ALL USING (has_admin_role(auth.uid(), ARRAY['owner_admin']))
  WITH CHECK (has_admin_role(auth.uid(), ARRAY['owner_admin']));

DROP TRIGGER IF EXISTS trg_prevent_delete ON partner_commissions;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON partner_commissions
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

COMMENT ON TABLE partner_commissions IS
  'v8.3 E10 D.10.6: comisiones calculadas por calculatePartnerCommission (src/lib/partner-commissions.ts). requires_t4a siempre true -- nunca regalo personal oculto a property managers (E9.11, riesgo penal s.426).';

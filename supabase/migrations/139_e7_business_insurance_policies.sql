-- Migración 139 — v8.3 E7 (D.9 punto 9): registro de pólizas de seguro del
-- NEGOCIO (distinto del seguro por vehículo, ya cubierto en 047).
--
-- Contexto: el spec pide registrar y alertar sobre 3 pólizas reales del
-- negocio (vehicular $2M, general $5M, E&O $1M; alerta 30 días, bloqueo si
-- vencido). Hasta ahora solo existía vehicles.insurance_expiry_date (seguro
-- de CADA vehículo individual) -- nada rastreaba las pólizas del negocio en
-- sí. Nota importante (B.4): esta migración NO desbloquea el claim público
-- "asegurados/bonded" en el sitio -- ese sigue 🚨 BLOQUEADO hasta que el
-- dueño confirme por escrito que las pólizas reales están contratadas. Esto
-- es solo la infraestructura para que, cuando las contrate, quede
-- registrado y con alertas -- exactamente el mismo patrón que ya funcionó
-- para vehículos (047_e7_vehicle_insurance_risk_nearmiss.sql).

CREATE TABLE IF NOT EXISTS business_insurance_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_type TEXT NOT NULL CHECK (policy_type IN ('vehicular', 'general_liability', 'errors_omissions')),
  provider TEXT NOT NULL,
  policy_number TEXT,
  coverage_amount_cents INTEGER NOT NULL CHECK (coverage_amount_cents > 0),
  effective_from DATE NOT NULL,
  expiry_date DATE NOT NULL,
  document_url TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- Solo una póliza ACTIVA por tipo a la vez (mismo espíritu que
-- pricing_settings/fixed_costs_settings: una fila vigente, historial se
-- conserva desactivando en vez de borrar).
CREATE UNIQUE INDEX IF NOT EXISTS idx_business_insurance_one_active_per_type
  ON business_insurance_policies (policy_type)
  WHERE is_active = true AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_business_insurance_expiry
  ON business_insurance_policies (expiry_date)
  WHERE is_active = true AND deleted_at IS NULL;

ALTER TABLE business_insurance_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_admin manages business insurance" ON business_insurance_policies;
CREATE POLICY "owner_admin manages business insurance" ON business_insurance_policies
  FOR ALL USING (has_admin_role(auth.uid(), ARRAY['owner_admin']))
  WITH CHECK (has_admin_role(auth.uid(), ARRAY['owner_admin']));

DROP TRIGGER IF EXISTS trg_prevent_delete ON business_insurance_policies;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON business_insurance_policies
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

COMMENT ON TABLE business_insurance_policies IS
  'v8.3 E7/D.9: pólizas reales del negocio (vehicular/general/E&O), alerta 30 días. NO desbloquea el claim público "asegurados/bonded" (B.4) -- eso requiere confirmación escrita del dueño por separado.';

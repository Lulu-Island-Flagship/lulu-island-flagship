-- v8.3 E10.8 — Marketing de empleados: reels "un día en la vida" e insignias
-- públicas en el sitio, AMBOS con consentimiento explícito del empleado y
-- aprobación de un toque del admin antes de publicar (D.10.8).
--
-- Invariante clave: el consentimiento lo da el empleado sobre SU propio
-- registro (nunca un admin en su nombre), y puede retirarlo en cualquier
-- momento -- retirar consentimiento despublica automáticamente (lo aplica
-- la función pura evaluateEmployeeMarketingVisibility en TS, no un trigger,
-- para que quede testeada sin DB).

CREATE TABLE IF NOT EXISTS employee_marketing_features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id),
  feature_type TEXT NOT NULL CHECK (feature_type IN ('day_in_life_reel', 'public_badge_showcase')),
  employee_consented_at TIMESTAMPTZ,
  employee_consent_withdrawn_at TIMESTAMPTZ,
  admin_approved_at TIMESTAMPTZ,
  admin_approved_by UUID REFERENCES auth.users(id),
  asset_url TEXT, -- link al reel/asset final (subido fuera de este sistema)
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_employee_marketing_features_employee ON employee_marketing_features(employee_id);

ALTER TABLE employee_marketing_features ENABLE ROW LEVEL SECURITY;

-- El empleado puede ver y otorgar/retirar su propio consentimiento.
CREATE POLICY employee_marketing_self_select ON employee_marketing_features
  FOR SELECT USING (
    employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
  );

CREATE POLICY employee_marketing_self_consent_update ON employee_marketing_features
  FOR UPDATE USING (
    employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
  ) WITH CHECK (
    employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
  );

-- Admin: acceso vía service role en la API (requireAdminRole), no vía RLS de cliente.
CREATE POLICY employee_marketing_admin_via_service_role ON employee_marketing_features
  FOR ALL USING (false) WITH CHECK (false);

CREATE TRIGGER prevent_hard_delete_employee_marketing_features
  BEFORE DELETE ON employee_marketing_features
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

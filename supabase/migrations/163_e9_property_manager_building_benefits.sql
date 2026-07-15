-- Migración 163 — v8.3 E9.11: vía (a) del beneficio a property managers --
-- "beneficio transparente al edificio" (ej. sesión de limpieza para áreas
-- comunes). La vía (b) ("comisión de partnership declarada con T4A") YA
-- existe completa desde la migración 147 (partner_commissions,
-- partner_type='property_manager', requires_t4a=true) -- no se duplica
-- aquí, solo se agrega la vía (a) que no tenía dónde persistirse.
--
-- src/lib/gift-program.ts::createPropertyManagerBenefit ya existía pero
-- era lógica huérfana (nunca llamada por ninguna ruta) -- esta tabla + la
-- ruta que la usa cierran ese hueco.

CREATE TABLE IF NOT EXISTS property_manager_building_benefits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID NOT NULL REFERENCES partners(id),
  description TEXT NOT NULL,
  delivered_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pm_building_benefits_partner ON property_manager_building_benefits(partner_id);

ALTER TABLE property_manager_building_benefits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Supervisors manage building benefits" ON property_manager_building_benefits;
CREATE POLICY "Supervisors manage building benefits" ON property_manager_building_benefits
  FOR ALL USING (is_supervisor(auth.uid())) WITH CHECK (is_supervisor(auth.uid()));

COMMENT ON TABLE property_manager_building_benefits IS
  'v8.3 E9.11 vía (a): beneficio transparente al edificio, nunca un regalo personal oculto (riesgo penal s.426). requires_t4a=false por diseño -- no es un pago en dinero al PM. La vía (b) vive en partner_commissions.';

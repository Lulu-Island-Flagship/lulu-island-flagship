-- Migración 153 — v8.3 E5.2: anti-gaming del muro QC. La ruta
-- /api/admin/qc tenía la auto-aprobación de élite completamente
-- DESHABILITADA a propósito ("BLOQUEANTE antes de usar auto-approval con
-- empleados reales") porque no existía detección de manipulación: sin ella,
-- un empleado élite podría explotar el auto-approve indefinidamente. Esta
-- migración agrega lo que faltaba para habilitarlo de forma segura:
--   1. Muestreo 10% sobre servicios que habrían sido auto-aprobados (además
--      del auto-approval real) -- si el muestreo rechaza >15%, se considera
--      manipulación detectada.
--   2. Registro histórico de detecciones (gaming_detections) para saber si
--      es la primera o segunda vez (la segunda = suspensión, no solo
--      revocación de auto-aprobación).
--   3. Columna employees.auto_approval_revoked_at: mientras no sea null, el
--      empleado NUNCA se auto-aprueba sin importar su trust_level (fuerza
--      muro QC completo hasta que un admin lo reactive explícitamente).
--   4. Columna employees.suspension_reason: motivo documentado y legible
--      cuando trust_level pasa a 'suspended' por manipulación (nunca un
--      despido automático -- el despido final sigue siendo decisión humana,
--      B.2.23; esto solo documenta la causal).

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS auto_approval_revoked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspension_reason TEXT;

CREATE TABLE IF NOT EXISTS gaming_detections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id),
  detection_number INTEGER NOT NULL CHECK (detection_number >= 1),
  triggering_qc_review_id UUID REFERENCES qc_reviews(id),
  sampled_rejection_rate NUMERIC NOT NULL,
  action_taken TEXT NOT NULL CHECK (action_taken IN ('auto_approval_revoked', 'suspended')),
  retroactive_review_order_ids UUID[] NOT NULL DEFAULT '{}',
  notes TEXT,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_gaming_detections_employee ON gaming_detections(employee_id);

ALTER TABLE gaming_detections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Supervisors read gaming detections" ON gaming_detections;
CREATE POLICY "Supervisors read gaming detections" ON gaming_detections
  FOR SELECT USING (is_supervisor(auth.uid()));

DROP POLICY IF EXISTS "Supervisors insert gaming detections" ON gaming_detections;
CREATE POLICY "Supervisors insert gaming detections" ON gaming_detections
  FOR INSERT WITH CHECK (is_supervisor(auth.uid()));

DROP TRIGGER IF EXISTS trg_prevent_delete ON gaming_detections;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON gaming_detections
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

COMMENT ON TABLE gaming_detections IS
  'v8.3 E5.2: historial inmutable de manipulaciones detectadas en el muro QC. detection_number=1 revoca auto-aprobación + revisión retroactiva de 10 servicios; detection_number=2 suspende (trust_level=suspended + suspension_reason).';

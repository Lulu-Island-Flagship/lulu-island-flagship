-- Migración 190 — v8.3 E5 (auditoría 2026-07-18): estado 'rework' en el muro QC.
--
-- Problema real: qc_reviews.status (migración 010) solo admitía
-- pending/approved/rejected/auto. En la práctica, un admin que revisa un
-- servicio con un problema menor y corregible (ej. faltó una foto de una
-- zona, una tarea quedó incompleta) solo tenía dos salidas: 'approved' (deja
-- pasar algo incompleto) o 'rejected' (trata un defecto menor igual que uno
-- grave, sin darle al empleado la oportunidad de corregirlo rápido). No
-- existía un estado intermedio de "corrígelo ahora" con plazo.
--
-- Diseño: 'rework' es un estado transitorio con timer de 30 minutos
-- (rework_deadline). Mientras está en 'rework':
--   - El servicio NO entra al Batch Capture 7PM (ver evaluateQcGate en
--     src/lib/batch-capture-eligibility.ts, solo 'approved'/'auto' pasan).
--   - El empleado puede resubmitir (vía /api/empleado/qc/[orderId]/resubmit)
--     -- vuelve a 'pending' para que el admin lo revise de nuevo.
--   - Si pasan los 30 minutos sin resubmisión, el cron
--     qc-rework-expiry lo pasa automáticamente a 'rejected' y deja rastro en
--     tickets_disputas -- consecuencia documentada, no una suspensión ni
--     despido automático (B.2.23 sigue siendo decisión humana).

ALTER TABLE qc_reviews DROP CONSTRAINT IF EXISTS qc_reviews_status_check;
ALTER TABLE qc_reviews ADD CONSTRAINT qc_reviews_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'auto', 'rework'));

ALTER TABLE qc_reviews
  ADD COLUMN IF NOT EXISTS rework_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rework_deadline TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rework_note TEXT,
  ADD COLUMN IF NOT EXISTS rework_resubmitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rework_expired_at TIMESTAMPTZ;

COMMENT ON COLUMN qc_reviews.rework_deadline IS
  'v8.3 E5: 30 minutos desde rework_started_at. Si status sigue en rework tras el deadline, el cron qc-rework-expiry lo pasa a rejected automáticamente.';

CREATE INDEX IF NOT EXISTS idx_qc_reviews_rework_deadline
  ON qc_reviews(rework_deadline)
  WHERE status = 'rework';

-- El empleado dueño del servicio puede leer y actualizar su propia fila
-- mientras está en rework (para poder resubmitir) -- antes solo existían
-- políticas de supervisor para insert/update.
DROP POLICY IF EXISTS "Employees read own qc reviews" ON qc_reviews;
CREATE POLICY "Employees read own qc reviews" ON qc_reviews
  FOR SELECT USING (employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Employees resubmit own rework" ON qc_reviews;
CREATE POLICY "Employees resubmit own rework" ON qc_reviews
  FOR UPDATE
  USING (employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid()) AND status = 'rework')
  WITH CHECK (employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid()));

-- Feature flag para el gate de QC en el Batch Capture (src/app/api/cron/batch-capture/route.ts).
-- Apagado por defecto, mismo patrón que los demás flags de dinero de este
-- módulo (validar en staging antes de represar cobros reales -- migración
-- 016 crea qc_reviews 'pending' para TODO empleado no-élite al completar el
-- servicio, así que activar esto sin validar podría represar la mayoría de
-- la caja del día).
INSERT INTO feature_flags (nombre, activo, modulo, descripcion)
VALUES (
  'batch_capture_qc_gate_enabled',
  false,
  'E5',
  'Excluir del Batch Capture 7PM las órdenes cuyo qc_reviews.status no sea approved/auto (pending/rejected/rework quedan fuera); encola en tickets_disputas para revisión manual'
)
ON CONFLICT (nombre) DO UPDATE SET activo = false;

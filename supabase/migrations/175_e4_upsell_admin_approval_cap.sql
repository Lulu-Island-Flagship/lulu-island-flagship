-- Migración 175 — FIX-6 (D.10 #7 / B.5): "tope: upsell ≤50% del valor base
-- sin aprobación admin". Antes de este cambio, POST /api/empleado/upsells
-- insertaba cualquier monto sin verificar contra el valor base de la orden
-- -- el límite del 50% existía solo como texto en el plan, nunca como
-- código. Este cambio agrega el estado de aprobación: un upsell que deja el
-- acumulado del día por debajo o igual al 50% se auto-aprueba; uno que lo
-- supera queda 'pending_admin_approval' y no debe cobrarse/comisionarse
-- hasta que un admin lo apruebe (POST /api/admin/upsells/[id]/approve,
-- construido junto con esta migración).

ALTER TABLE service_upsells
  ADD COLUMN IF NOT EXISTS requires_admin_approval BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'auto_approved'
    CHECK (approval_status IN ('auto_approved', 'pending_admin_approval', 'admin_approved', 'admin_rejected')),
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_service_upsells_approval_status ON service_upsells(approval_status);

COMMENT ON COLUMN service_upsells.approval_status IS
  'v8.3 FIX-6 (B.5): auto_approved si el acumulado de upsells de la orden queda <=50% de quotes.total; pending_admin_approval si lo supera -- un admin debe aprobar/rechazar antes de que cuente para comisión/Batch Capture.';

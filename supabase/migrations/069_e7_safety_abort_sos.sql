-- Migración 069 — v8.3 E7 (D.10 excepción #7): cadena de escalación de aborto
-- seguro (SOS). Estructura vacía a propósito: sin datos de negocio inventados.
--
-- Flujo: doble confirmación -> SOS con GPS vivo -> llamada auto a admin
-- (2 min) -> Admin de Emergencia (4 min) -> Fallback 10 min: auto-aprobado
-- por seguridad. La lógica de qué etapa corresponde a cada momento vive en
-- src/lib/safety-abort.ts (función pura, testeada) — esta tabla solo
-- persiste los timestamps de los que esa función se alimenta.
--
-- Regla dura (B.3.5): revisión ex-post SIEMPRE obligatoria, sin excepción;
-- si la evidencia respalda al líder, la sanción queda prohibida.

CREATE TABLE IF NOT EXISTS safety_aborts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  reported_by UUID REFERENCES employees(id) ON DELETE SET NULL,
  reason TEXT,

  -- Doble confirmación: ambos timestamps deben existir antes de que el SOS
  -- pueda considerarse activo (isDoubleConfirmed en safety-abort.ts).
  first_confirmed_at TIMESTAMPTZ,
  second_confirmed_at TIMESTAMPTZ,

  -- SOS con GPS vivo: se actualiza mientras el SOS sigue activo.
  sos_started_at TIMESTAMPTZ,
  gps_lat DOUBLE PRECISION,
  gps_lng DOUBLE PRECISION,
  gps_updated_at TIMESTAMPTZ,

  -- Un admin (cualquier nivel) puede reconocer el SOS y detener la escalación.
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES employees(id) ON DELETE SET NULL,

  -- Etapa calculada al momento de cada lectura/escritura relevante, guardada
  -- como snapshot para auditoría (la fuente de verdad viva es la función pura).
  stage TEXT NOT NULL DEFAULT 'sos_active'
    CHECK (stage IN ('sos_active', 'escalated_admin_call', 'escalated_emergency_admin', 'auto_approved', 'acknowledged')),
  auto_approved BOOLEAN NOT NULL DEFAULT false,

  -- Revisión ex-post — punto #5 de B.3 (los 6 únicos puntos de intervención
  -- humana obligatoria). SIEMPRE requerida; el sistema no puede cerrarse sin
  -- ella, sin importar en qué etapa se auto-aprobó el aborto.
  ex_post_reviewed_at TIMESTAMPTZ,
  ex_post_reviewed_by UUID REFERENCES employees(id) ON DELETE SET NULL,
  evidence_supports_leader BOOLEAN,
  sanction_prohibited BOOLEAN,
  review_notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_safety_aborts_order ON safety_aborts(order_id);
CREATE INDEX IF NOT EXISTS idx_safety_aborts_reported_by ON safety_aborts(reported_by);
CREATE INDEX IF NOT EXISTS idx_safety_aborts_pending_review
  ON safety_aborts(ex_post_reviewed_at) WHERE ex_post_reviewed_at IS NULL;

ALTER TABLE safety_aborts ENABLE ROW LEVEL SECURITY;

-- Cualquier empleado autenticado puede iniciar/actualizar su propio SOS
-- (P0 seguridad humana: nunca debe bloquearse por RBAC administrativo).
DROP POLICY IF EXISTS "Employees create own safety aborts" ON safety_aborts;
CREATE POLICY "Employees create own safety aborts" ON safety_aborts
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Employees update own safety aborts" ON safety_aborts;
CREATE POLICY "Employees update own safety aborts" ON safety_aborts
  FOR UPDATE USING (
    reported_by IN (SELECT id FROM employees WHERE user_id = auth.uid())
    OR is_supervisor(auth.uid())
  );

DROP POLICY IF EXISTS "Supervisors read safety aborts" ON safety_aborts;
CREATE POLICY "Supervisors read safety aborts" ON safety_aborts
  FOR SELECT USING (
    is_supervisor(auth.uid())
    OR reported_by IN (SELECT id FROM employees WHERE user_id = auth.uid())
  );

-- Soft delete universal (B.2.9): eliminar es UPDATE, nunca DELETE.
DROP TRIGGER IF EXISTS trg_prevent_delete ON safety_aborts;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON safety_aborts
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

COMMENT ON TABLE safety_aborts IS
  'v8.3 E7 (D.10 #7): cadena SOS de aborto seguro. Escalacion 2/4/10 min calculada por src/lib/safety-abort.ts. Revision ex-post SIEMPRE obligatoria (B.3.5).';

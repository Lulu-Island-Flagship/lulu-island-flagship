-- v8.3 E4.11 — Protocolo de Cierre Externo
-- Dueño del módulo: E4 (ejecución física). Lee esta tabla: E5 (QC), route.ts T_out.
--
-- Del plan: "COMPLETADO requiere (1) checklist 100% verde, (2) ≥1 foto
-- 'después' por zona, (3) implementos confirmados, (4) confirmación externa
-- (cliente aprueba verbal, o auditoría visual del líder con foto de cierre,
-- o Auditor presente), (5) T_out."
--
-- Los requisitos (1) y (2) ya se derivan de sop_checklists / service_checklist_items
-- (existentes desde 006_modulo4_checklist_tables.sql). Esta tabla registra
-- los dos requisitos que no tenían dónde vivir: implementos confirmados y
-- confirmación externa. route.ts las lee junto con el checklist antes de
-- aceptar T_out (src/lib/closure-protocol.ts decide si está completo).

CREATE TABLE IF NOT EXISTS service_closures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,

  implementos_confirmed BOOLEAN NOT NULL DEFAULT false,
  implementos_confirmed_at TIMESTAMPTZ,

  external_confirmation_type TEXT
    CHECK (external_confirmation_type IN ('client_verbal', 'leader_audit', 'auditor_present')),
  external_confirmation_at TIMESTAMPTZ,
  external_confirmation_notes TEXT,

  estado TEXT NOT NULL DEFAULT 'active',
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Un solo registro de cierre "vivo" por orden+empleado.
  UNIQUE (order_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_service_closures_order ON service_closures(order_id);
CREATE INDEX IF NOT EXISTS idx_service_closures_employee ON service_closures(employee_id);
CREATE INDEX IF NOT EXISTS idx_service_closures_not_deleted ON service_closures(order_id) WHERE deleted_at IS NULL;

ALTER TABLE service_closures ENABLE ROW LEVEL SECURITY;

-- Empleados leen/escriben su propio registro de cierre.
CREATE POLICY "Employees read own closure" ON service_closures
  FOR SELECT USING (
    employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
  );

CREATE POLICY "Employees insert own closure" ON service_closures
  FOR INSERT WITH CHECK (
    employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
  );

CREATE POLICY "Employees update own closure" ON service_closures
  FOR UPDATE USING (
    employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
  );

-- Supervisores ven todos los cierres (QC, E5).
CREATE POLICY "Supervisors read all closures" ON service_closures
  FOR SELECT USING (is_supervisor(auth.uid()));

-- Soft delete universal (B.2.9): reescribe DELETE a UPDATE deleted_at=now(),
-- reutilizando la función genérica de 039_e0_soft_delete_universal.sql
-- (mismo patrón que assignments / sop_checklists / pricing_rules).
DROP TRIGGER IF EXISTS trg_soft_delete ON service_closures;
CREATE TRIGGER trg_soft_delete BEFORE DELETE ON service_closures
  FOR EACH ROW EXECUTE FUNCTION soft_delete_rewrite();

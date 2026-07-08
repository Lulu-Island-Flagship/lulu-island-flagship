-- ============================================================
-- E0 RETROFIT — Criterio 3: RBAC Administrativo (v8.3, M0 Fase 0.9)
-- Tres roles ADMINISTRATIVOS, separados de los roles de CAMPO
-- (employees.role = cleaner/supervisor/driver se mantiene intacto):
--   owner_admin     : todo (finanzas, nómina, configuración, operación)
--   ops_coordinator : despacho, tickets, QC, servicios — SIN finanzas ni nómina
--   qc_only         : muro de fotos QC, nada más
-- ============================================================

CREATE TABLE IF NOT EXISTS admin_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner_admin', 'ops_coordinator', 'qc_only')),
  granted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (user_id, role)
);

CREATE INDEX IF NOT EXISTS idx_admin_roles_user ON admin_roles(user_id) WHERE deleted_at IS NULL;

-- Soft delete obligatorio (invariante B.2.9)
DROP TRIGGER IF EXISTS trg_prevent_delete ON admin_roles;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON admin_roles
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

-- ------------------------------------------------------------
-- Helper: ¿el usuario tiene alguno de estos roles admin?
-- SECURITY DEFINER para uso en políticas RLS sin recursión.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION has_admin_role(user_uuid UUID, roles TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM admin_roles
    WHERE user_id = user_uuid
      AND role = ANY(roles)
      AND deleted_at IS NULL
  );
$$;

-- ------------------------------------------------------------
-- RLS de la propia tabla admin_roles
-- ------------------------------------------------------------
ALTER TABLE admin_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own admin roles" ON admin_roles
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "owner reads all admin roles" ON admin_roles
  FOR SELECT USING (has_admin_role(auth.uid(), ARRAY['owner_admin']));

CREATE POLICY "owner manages admin roles" ON admin_roles
  FOR INSERT WITH CHECK (has_admin_role(auth.uid(), ARRAY['owner_admin']));

CREATE POLICY "owner updates admin roles" ON admin_roles
  FOR UPDATE USING (has_admin_role(auth.uid(), ARRAY['owner_admin']));

-- ------------------------------------------------------------
-- is_supervisor() ampliado: owner_admin y ops_coordinator obtienen
-- acceso de nivel supervisor en las políticas RLS existentes.
-- qc_only NO — su acceso se define abajo, tabla por tabla.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_supervisor(user_uuid UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM employees
    WHERE user_id = user_uuid AND role = 'supervisor' AND is_active = true
  )
  OR has_admin_role(user_uuid, ARRAY['owner_admin', 'ops_coordinator']);
$$;

-- ------------------------------------------------------------
-- Acceso de lectura del rol qc_only: SOLO el muro de evidencia.
-- Explícitamente NO se le da acceso a: employees (contiene Day Rate),
-- payroll_entries, pricing_*, chargeback_*, hhe_settings, wallets.
-- ------------------------------------------------------------
CREATE POLICY "qc_only reads qc_reviews" ON qc_reviews
  FOR SELECT USING (has_admin_role(auth.uid(), ARRAY['qc_only']));

CREATE POLICY "qc_only updates qc_reviews" ON qc_reviews
  FOR UPDATE USING (has_admin_role(auth.uid(), ARRAY['qc_only']));

CREATE POLICY "qc_only reads service_logs" ON service_logs
  FOR SELECT USING (has_admin_role(auth.uid(), ARRAY['qc_only']));

CREATE POLICY "qc_only reads checklist items" ON service_checklist_items
  FOR SELECT USING (has_admin_role(auth.uid(), ARRAY['qc_only']));

CREATE POLICY "qc_only reads orders" ON orders
  FOR SELECT USING (has_admin_role(auth.uid(), ARRAY['qc_only']));

-- ------------------------------------------------------------
-- Log de auditoría por usuario admin (requisito E0.5)
-- Inmutable: DELETE bloqueado.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_action_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  role_used TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  resource TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_action_logs_user ON admin_action_logs(user_id, created_at);

DROP TRIGGER IF EXISTS trg_prevent_delete ON admin_action_logs;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON admin_action_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

ALTER TABLE admin_action_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner reads action logs" ON admin_action_logs
  FOR SELECT USING (has_admin_role(auth.uid(), ARRAY['owner_admin']));

CREATE POLICY "any admin writes own action log" ON admin_action_logs
  FOR INSERT WITH CHECK (user_id = auth.uid());

COMMENT ON TABLE admin_roles IS 'v8.3 E0-C3: roles administrativos (owner_admin/ops_coordinator/qc_only), separados de employees.role';
COMMENT ON TABLE admin_action_logs IS 'v8.3 E0-C3: log inmutable de acciones admin por usuario';

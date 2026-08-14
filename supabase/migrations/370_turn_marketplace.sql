-- ============================================================
-- v8.3 F.8 — Marketplace de Turnos entre empleados
-- ============================================================

-- Función auxiliar para triggers de updated_at (usada por varias tablas)
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Helper: verifica si el usuario autenticado es un empleado activo
CREATE OR REPLACE FUNCTION is_employee(user_uuid UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM employees
    WHERE user_id = user_uuid
      AND deleted_at IS NULL
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE;
-- Tabla: turn_marketplace_offers
--   Reemplaza el caos de WhatsApp para cobertura de turnos.
--   src/lib/turn-marketplace.ts contiene las funciones puras de validación.
-- ============================================================

-- 1. Tabla principal
CREATE TABLE IF NOT EXISTS turn_marketplace_offers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  order_id            uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  shift_date          date NOT NULL,
  start_time          time NOT NULL,
  end_time            time NOT NULL,
  zone                text NOT NULL,
  estimated_pay_cents integer NOT NULL CHECK (estimated_pay_cents > 0),
  note                text,
  status              text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','offer_submitted','approved','rejected','cancelled','expired')),
  created_at_iso      timestamptz NOT NULL DEFAULT now(),
  expires_at_iso      timestamptz NOT NULL,
  -- Quién se ofreció a cubrir (null hasta que alguien se postule)
  offering_employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  offered_at_iso      timestamptz,
  -- Quién resolvió (admin) y cuándo
  resolved_by_admin_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  resolved_at_iso     timestamptz,
  -- Trazabilidad estándar
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_tmo_status          ON turn_marketplace_offers(status)          WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tmo_shift_date      ON turn_marketplace_offers(shift_date)      WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tmo_original_emp    ON turn_marketplace_offers(original_employee_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tmo_offering_emp    ON turn_marketplace_offers(offering_employee_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tmo_order           ON turn_marketplace_offers(order_id)         WHERE deleted_at IS NULL;

-- Trigger para updated_at
DROP TRIGGER IF EXISTS trg_tmo_updated_at ON turn_marketplace_offers;
CREATE TRIGGER trg_tmo_updated_at
  BEFORE UPDATE ON turn_marketplace_offers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 2. RLS: empleados leen ofertas abiertas; admins full access
-- ============================================================
ALTER TABLE turn_marketplace_offers ENABLE ROW LEVEL SECURITY;

-- Empleados autenticados pueden ver ofertas abiertas (para ofrecerse)
DROP POLICY IF EXISTS "Employees read open offers" ON turn_marketplace_offers;
CREATE POLICY "Employees read open offers" ON turn_marketplace_offers
  FOR SELECT USING (
    is_employee(auth.uid())
    AND status IN ('open', 'offer_submitted')
    AND deleted_at IS NULL
  );

-- Empleados autenticados pueden ver sus propias ofertas (historial)
DROP POLICY IF EXISTS "Employees read own offers" ON turn_marketplace_offers;
CREATE POLICY "Employees read own offers" ON turn_marketplace_offers
  FOR SELECT USING (
    is_employee(auth.uid())
    AND (
      original_employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
      OR offering_employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
    )
  );

-- Empleados pueden insertar ofertas (publicar sus turnos)
DROP POLICY IF EXISTS "Employees insert own offers" ON turn_marketplace_offers;
CREATE POLICY "Employees insert own offers" ON turn_marketplace_offers
  FOR INSERT WITH CHECK (
    is_employee(auth.uid())
    AND original_employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
  );

-- Empleados pueden actualizar ofertas abiertas (ofrecerse como voluntario)
DROP POLICY IF EXISTS "Employees update open offers" ON turn_marketplace_offers;
CREATE POLICY "Employees update open offers" ON turn_marketplace_offers
  FOR UPDATE USING (
    is_employee(auth.uid())
    AND status = 'open'
    AND deleted_at IS NULL
  ) WITH CHECK (
    is_employee(auth.uid())
    AND status = 'open'
    AND deleted_at IS NULL
  );

-- Supervisores: full access (admin aprueba/rechaza)
DROP POLICY IF EXISTS "Supervisors full access offers" ON turn_marketplace_offers;
CREATE POLICY "Supervisors full access offers" ON turn_marketplace_offers
  FOR ALL USING (is_supervisor(auth.uid()))
  WITH CHECK (is_supervisor(auth.uid()));

-- ============================================================
-- 3. Feature flag: apagado por defecto
-- ============================================================
INSERT INTO feature_flags (nombre, activo, modulo, descripcion)
VALUES ('turn_marketplace_enabled', false, 'Módulo 3', 'Marketplace de turnos entre empleados — publicar/cubrir turnos')
ON CONFLICT (nombre) DO NOTHING;

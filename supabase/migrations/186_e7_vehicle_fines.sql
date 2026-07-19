-- Migración 186 — v8.3 E7 fix de auditoría: multas vehiculares.
--
-- Hallazgo: el spec de flota (vehicles: seguro/registro/mantenimiento, ya
-- cubierto en 047) no tenía dónde registrar multas de tránsito/parking
-- recibidas por un vehículo/conductor de la empresa -- una excepción real
-- de operación de flota que hoy no se puede ni documentar. Esta migración
-- crea la estructura (vacía a propósito, mismo criterio que 048: no se
-- inventan multas reales).

CREATE TABLE IF NOT EXISTS vehicle_fines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id),
  driver_employee_id UUID REFERENCES employees(id),
  address TEXT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  fine_date DATE NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'unpaid'
    CHECK (status IN ('unpaid', 'paid', 'disputed')),
  paid_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_vehicle_fines_vehicle ON vehicle_fines(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_fines_driver ON vehicle_fines(driver_employee_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_fines_status ON vehicle_fines(status) WHERE deleted_at IS NULL;

ALTER TABLE vehicle_fines ENABLE ROW LEVEL SECURITY;

-- Mismo nivel de acceso que la tabla vehicles (migración 026): supervisores
-- gestionan, resto de empleados no necesita verlas (dato administrativo de
-- flota, no operativo de campo).
DROP POLICY IF EXISTS "Supervisors manage vehicle fines" ON vehicle_fines;
CREATE POLICY "Supervisors manage vehicle fines" ON vehicle_fines
  FOR ALL USING (is_supervisor(auth.uid())) WITH CHECK (is_supervisor(auth.uid()));

DROP TRIGGER IF EXISTS trg_prevent_delete ON vehicle_fines;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON vehicle_fines
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

COMMENT ON TABLE vehicle_fines IS
  'v8.3 E7: estructura vacia a proposito. Multas vehiculares reales se cargan desde el admin (GET/POST /api/admin/vehicle-fines).';

-- Migración 047 — v8.3 E7: seguro vencido bloquea asignación de vehículo,
-- pre-evaluación de riesgo por dirección, y reporte de near-misses.

-- ============================================================
-- 1. Vehículos: fechas de vencimiento de seguro/registro/mantenimiento
-- ============================================================
ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS insurance_expiry_date DATE,
  ADD COLUMN IF NOT EXISTS registration_expiry_date DATE,
  ADD COLUMN IF NOT EXISTS next_maintenance_due_date DATE;

-- Criterio de aceptación E7: "Vehículo con seguro vencido no puede ser
-- asignado (test negativo)". La asignación persistente vive en
-- employees.vehicle_id — bloqueamos ahí, no borramos el vehículo.
CREATE OR REPLACE FUNCTION prevent_expired_vehicle_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expiry DATE;
BEGIN
  IF NEW.vehicle_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Sin cambio real de vehiculo: no re-validar (evita bloquear updates
  -- de otros campos del empleado cuando el vehiculo ya estaba asignado
  -- y solo vencio despues del hecho -- eso se atiende con alerta, no bloqueo retroactivo)
  IF TG_OP = 'UPDATE' AND OLD.vehicle_id IS NOT DISTINCT FROM NEW.vehicle_id THEN
    RETURN NEW;
  END IF;

  SELECT insurance_expiry_date INTO v_expiry
  FROM vehicles
  WHERE id = NEW.vehicle_id;

  IF v_expiry IS NOT NULL AND v_expiry < CURRENT_DATE THEN
    RAISE EXCEPTION 'No se puede asignar el vehículo %: seguro vencido desde % (v8.3 E7)', NEW.vehicle_id, v_expiry;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_expired_vehicle_assignment ON employees;
CREATE TRIGGER trg_prevent_expired_vehicle_assignment
  BEFORE INSERT OR UPDATE OF vehicle_id ON employees
  FOR EACH ROW
  EXECUTE FUNCTION prevent_expired_vehicle_assignment();

COMMENT ON FUNCTION prevent_expired_vehicle_assignment() IS
  'v8.3 E7: bloquea asignar (employees.vehicle_id) un vehiculo con seguro vencido.';

-- ============================================================
-- 2. Pre-evaluación de riesgo por dirección (property_risk_assessments)
-- ============================================================
CREATE TABLE IF NOT EXISTS property_risk_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_property_id UUID NOT NULL REFERENCES client_properties(id) ON DELETE CASCADE,
  flags TEXT[] NOT NULL DEFAULT '{}',
  flag_count INTEGER NOT NULL DEFAULT 0,
  tier TEXT NOT NULL DEFAULT 'standard'
    CHECK (tier IN ('standard', 'auditor_required', 'pre_inspection_required')),
  hard_blocked BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  assessed_by UUID REFERENCES employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_property_risk_property ON property_risk_assessments(client_property_id);

ALTER TABLE property_risk_assessments ENABLE ROW LEVEL SECURITY;

-- Visible a admin y líder (empleado con rol supervisor), NUNCA al cliente (regla explícita del spec).
DROP POLICY IF EXISTS "Supervisors read risk assessments" ON property_risk_assessments;
CREATE POLICY "Supervisors read risk assessments" ON property_risk_assessments
  FOR SELECT USING (is_supervisor(auth.uid()));
DROP POLICY IF EXISTS "Supervisors manage risk assessments" ON property_risk_assessments;
CREATE POLICY "Supervisors manage risk assessments" ON property_risk_assessments
  FOR ALL USING (is_supervisor(auth.uid())) WITH CHECK (is_supervisor(auth.uid()));

DROP TRIGGER IF EXISTS trg_prevent_delete ON property_risk_assessments;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON property_risk_assessments
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

-- ============================================================
-- 3. Near-misses (casi-accidentes) — reporte sin penalización
-- ============================================================
CREATE TABLE IF NOT EXISTS near_misses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL
    CHECK (category IN ('near_fall', 'near_chemical_mix', 'near_bite', 'near_burn', 'other')),
  description TEXT,
  is_anonymous BOOLEAN NOT NULL DEFAULT false,
  -- Si is_anonymous = true, reported_by se guarda igual para trazabilidad interna
  -- pero NUNCA se expone en consultas/reportes agregados (aplicación filtra la columna).
  reported_by UUID REFERENCES employees(id),
  order_id UUID REFERENCES orders(id),
  client_property_id UUID REFERENCES client_properties(id),
  consequence_action TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_near_misses_category ON near_misses(category);
CREATE INDEX IF NOT EXISTS idx_near_misses_created ON near_misses(created_at);

ALTER TABLE near_misses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Employees insert near misses" ON near_misses;
CREATE POLICY "Employees insert near misses" ON near_misses
  FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL
  );
DROP POLICY IF EXISTS "Supervisors read near misses" ON near_misses;
CREATE POLICY "Supervisors read near misses" ON near_misses
  FOR SELECT USING (is_supervisor(auth.uid()));

DROP TRIGGER IF EXISTS trg_prevent_delete ON near_misses;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON near_misses
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

COMMENT ON TABLE near_misses IS
  'v8.3 E7: reporte de casi-accidentes sin penalizacion, anonimato opcional (filtrado a nivel de aplicacion, no de dato).';

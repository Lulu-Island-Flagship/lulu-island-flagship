-- Migración 144 — v8.3 E7 (D.10, excepción #6 / D.9 compliance): lesión en
-- jornada → reporte WorkSafeBC pre-llenado dentro de 72h, alerta admin
-- inmediata, nunca admitir culpa (regla del manual de contingencia, línea
-- 578 del plan).
--
-- Distinta de `near_misses` (migración 047): near_misses es explícitamente
-- "casi-accidente SIN penalización, sin lesión". workplace_incidents es para
-- cuando SÍ hubo lesión o se requirió atención médica -- es el evento que
-- dispara la obligación legal de reportar a WorkSafeBC en 72h.
--
-- DISEÑO HONESTO: WorkSafeBC no tiene una API pública de envío -- el reporte
-- se presenta por su portal/teléfono. Esta tabla no "envía" nada; genera los
-- datos PRE-LLENADOS a partir de lo que el sistema ya sabe (empleado,
-- fecha/hora, descripción) para que el admin los copie al formulario real, y
-- lleva el cronómetro de 72h como obligación auditable.

CREATE TABLE IF NOT EXISTS workplace_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  employee_id UUID NOT NULL REFERENCES employees(id),
  reported_by UUID REFERENCES employees(id), -- puede ser el mismo empleado o quien lo reporta (líder/testigo)
  order_id UUID REFERENCES orders(id),
  client_property_id UUID REFERENCES client_properties(id),

  incident_datetime TIMESTAMPTZ NOT NULL,
  location_description TEXT,
  body_part_affected TEXT,
  injury_description TEXT NOT NULL,

  medical_attention_type TEXT NOT NULL DEFAULT 'none'
    CHECK (medical_attention_type IN ('none', 'first_aid', 'clinic', 'hospital')),

  witnesses TEXT,
  immediate_action_taken TEXT,

  -- Cronómetro legal: incident_datetime + 72h. Calculado por la aplicación
  -- (src/lib/workplace-incident.ts), guardado aquí para que quede fijo aunque
  -- cambie la hora de creación de la fila.
  worksafebc_report_due_at TIMESTAMPTZ NOT NULL,

  worksafebc_report_filed_at TIMESTAMPTZ,
  worksafebc_reference_number TEXT,
  filed_by UUID REFERENCES employees(id),

  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_workplace_incidents_due ON workplace_incidents(worksafebc_report_due_at);
CREATE INDEX IF NOT EXISTS idx_workplace_incidents_employee ON workplace_incidents(employee_id);

ALTER TABLE workplace_incidents ENABLE ROW LEVEL SECURITY;

-- Cualquier empleado autenticado puede reportar (a sí mismo o como testigo) --
-- "alerta admin inmediata" del spec exige que reportar sea lo más fácil
-- posible, sin fricción de rol.
DROP POLICY IF EXISTS "Employees insert workplace incidents" ON workplace_incidents;
CREATE POLICY "Employees insert workplace incidents" ON workplace_incidents
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Supervisors read workplace incidents" ON workplace_incidents;
CREATE POLICY "Supervisors read workplace incidents" ON workplace_incidents
  FOR SELECT USING (is_supervisor(auth.uid()));

DROP POLICY IF EXISTS "Supervisors update workplace incidents" ON workplace_incidents;
CREATE POLICY "Supervisors update workplace incidents" ON workplace_incidents
  FOR UPDATE USING (is_supervisor(auth.uid())) WITH CHECK (is_supervisor(auth.uid()));

DROP TRIGGER IF EXISTS trg_prevent_delete ON workplace_incidents;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON workplace_incidents
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

COMMENT ON TABLE workplace_incidents IS
  'v8.3 E7 D.10#6: incidentes con lesión/atención médica. worksafebc_report_due_at = incident_datetime + 72h. No envía nada a WorkSafeBC (sin API pública) -- solo pre-llena los datos y cronometra la obligación de reportar.';

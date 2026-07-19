-- Migración 185 — v8.3 E4: cierra 4 huecos reales de auditoría (2026-07-18)
-- sobre ejecución física en la PWA de líder.
--
-- 1) Poka-yoke químico sin enforcement server-side: ChemicalMatchModal.tsx
--    validaba la confirmación (color+ícono+texto) SOLO en el cliente y la
--    guardaba en un useState del componente padre — se perdía al refrescar
--    y, peor, un empleado podía llamar a POST /api/empleado/checklist
--    directamente y marcar is_completed=true en una zona química sin haber
--    confirmado nunca el producto. Se agrega la tabla
--    chemical_zone_confirmations como fuente de verdad server-side.
--
-- 2) Registro de llegada (T_in) sin geocerca de 50m real, GEOFENCE_RADIUS_
--    METERS=200 se reutilizaba también para T_in — separado en código
--    (src/lib/geocode.ts), sin cambio de esquema necesario para esto.
--
-- 3) Inicio de jornada sin validación GPS contra el punto de encuentro
--    (referencia = domicilio del primer servicio del día del empleado, la
--    única coordenada de referencia real que existe hoy en el sistema).
--    Se agregan columnas a service_logs para registrar la comparación.
--
-- 4) Bypass de geocerca de T_in sin las 3 salvaguardas (espera de 120s,
--    foto obligatoria, razón obligatoria + categoría estructurada). Se
--    agregan columnas a service_logs para el flag amarillo estructurado.

-- ============================================================
-- 1) Candado químico — confirmación persistida server-side
-- ============================================================
CREATE TABLE IF NOT EXISTS chemical_zone_confirmations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  zone_color TEXT NOT NULL,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, employee_id, zone_color)
);

CREATE INDEX IF NOT EXISTS idx_chemical_zone_confirmations_order_employee
  ON chemical_zone_confirmations(order_id, employee_id);

ALTER TABLE chemical_zone_confirmations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees read own chemical confirmations" ON chemical_zone_confirmations
  FOR SELECT USING (
    employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
  );

CREATE POLICY "Employees insert own chemical confirmations" ON chemical_zone_confirmations
  FOR INSERT WITH CHECK (
    employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
  );

CREATE POLICY "Supervisors read all chemical confirmations" ON chemical_zone_confirmations
  FOR SELECT USING (is_supervisor(auth.uid()));

COMMENT ON TABLE chemical_zone_confirmations IS
  'v8.3 E4 fix (auditoría 2026-07-18): registro server-side de que un '
  'empleado confirmó el código cromático (color+ícono+texto) de una zona '
  'para una orden específica. Fuente de verdad real del poka-yoke químico — '
  'sin una fila aquí, POST /api/empleado/checklist rechaza is_completed=true '
  'para ítems de esa zona/orden/empleado.';

-- ============================================================
-- 2) Inicio de jornada — comparación GPS contra punto de encuentro
-- ============================================================
ALTER TABLE service_logs
  ADD COLUMN IF NOT EXISTS outside_meeting_point BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS meeting_point_distance_m DOUBLE PRECISION;

COMMENT ON COLUMN service_logs.outside_meeting_point IS
  'v8.3 E4 fix (auditoría 2026-07-18): solo aplica a event_type=jornada_start. '
  'true si la distancia haversine entre el GPS de inicio de jornada y la '
  'coordenada del primer servicio del día del empleado supera '
  'MEETING_POINT_RADIUS_METERS (200m). No bloquea el inicio — solo flaggea '
  'para revisión de supervisor (mismo criterio que el bypass de geocerca).';

COMMENT ON COLUMN service_logs.meeting_point_distance_m IS
  'v8.3 E4 fix (auditoría 2026-07-18): distancia en metros calculada, para '
  'auditoría. NULL si no había coordenada de referencia disponible.';

-- ============================================================
-- 3) Bypass de geocerca de T_in — flag amarillo estructurado
-- ============================================================
ALTER TABLE service_logs
  ADD COLUMN IF NOT EXISTS geofence_bypass BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS geofence_bypass_category TEXT,
  ADD COLUMN IF NOT EXISTS geofence_bypass_reason TEXT;

ALTER TABLE service_logs DROP CONSTRAINT IF EXISTS service_logs_geofence_bypass_category_check;
ALTER TABLE service_logs ADD CONSTRAINT service_logs_geofence_bypass_category_check
  CHECK (
    geofence_bypass_category IS NULL OR geofence_bypass_category IN (
      'gps_inaccurate',       -- GPS impreciso / señal débil en el edificio
      'building_entrance_far', -- entrada del edificio lejos del pin geocodificado
      'parking_restriction',   -- tuvo que estacionar/entrar lejos del punto exacto
      'other'
    )
  );

COMMENT ON COLUMN service_logs.geofence_bypass IS
  'v8.3 E4 fix (auditoría 2026-07-18): true si este T_in se registró vía '
  'bypass manual de la geocerca de 50m (empleado fuera de rango). Requiere '
  'SIEMPRE geofence_bypass_category + geofence_bypass_reason + photo_url '
  '(las 3 salvaguardas), enforced en POST /api/empleado/servicio.';

COMMENT ON COLUMN service_logs.geofence_bypass_category IS
  'v8.3 E4 fix (auditoría 2026-07-18): categoría estructurada del motivo del '
  'bypass — nunca solo texto libre, para que el supervisor pueda filtrar/'
  'agregar patrones (ver CHECK constraint para valores válidos).';

COMMENT ON COLUMN service_logs.geofence_bypass_reason IS
  'v8.3 E4 fix (auditoría 2026-07-18): texto libre obligatorio adicional a '
  'la categoría estructurada — detalle específico del caso.';

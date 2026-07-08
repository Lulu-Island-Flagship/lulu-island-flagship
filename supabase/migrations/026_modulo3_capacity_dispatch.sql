-- Migración 026 — Módulo 3: Capacidad y Despacho Orquestado
-- Cierra los gap del spec: HHE/tiempo bloqueado, modelo 70/30, slots de capacidad,
-- scheduler 4:30/5:00/5:30, simulación 12:00, fallback de crisis, autopilot,
-- vehículos, tracking de vehículo, geocerca real, no-show automatizado y auditor de campo.

-- ============================================================
-- 1. Extender employees con modelo 70/30 y zona base
-- ============================================================
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS base_schedule_minutes INTEGER NOT NULL DEFAULT 480,
  ADD COLUMN IF NOT EXISTS contingency_minutes INTEGER NOT NULL DEFAULT 120,
  ADD COLUMN IF NOT EXISTS home_zone TEXT,
  ADD COLUMN IF NOT EXISTS trust_level TEXT NOT NULL DEFAULT 'standard'
    CHECK (trust_level IN ('elite', 'standard', 'probation')),
  ADD COLUMN IF NOT EXISTS vehicle_id UUID;

CREATE INDEX IF NOT EXISTS idx_employees_vehicle ON employees(vehicle_id);

-- ============================================================
-- 2. Tabla vehicles (tracking por vehículo, no por persona)
-- ============================================================
CREATE TABLE IF NOT EXISTS vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  plate TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  current_lat DOUBLE PRECISION,
  current_lng DOUBLE PRECISION,
  last_location_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Supervisors manage vehicles" ON vehicles
  FOR ALL USING (is_supervisor(auth.uid())) WITH CHECK (is_supervisor(auth.uid()));
CREATE POLICY IF NOT EXISTS "Employees read vehicles" ON vehicles
  FOR SELECT USING (true);

ALTER TABLE employees
  ADD CONSTRAINT fk_employees_vehicle
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL;

-- ============================================================
-- 3. Tabla vehicle_tracking (trazabilidad de ubicación del vehículo)
-- ============================================================
CREATE TABLE IF NOT EXISTS vehicle_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL DEFAULT 'driver_app'
    CHECK (source IN ('driver_app', 'gps_device', 'manual')),
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_vehicle_tracking_vehicle ON vehicle_tracking(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_tracking_recorded ON vehicle_tracking(recorded_at);

ALTER TABLE vehicle_tracking ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Supervisors read vehicle tracking" ON vehicle_tracking
  FOR SELECT USING (is_supervisor(auth.uid()));
CREATE POLICY IF NOT EXISTS "Drivers insert own vehicle tracking" ON vehicle_tracking
  FOR INSERT WITH CHECK (
    vehicle_id IN (SELECT vehicle_id FROM employees WHERE user_id = auth.uid() AND vehicle_id IS NOT NULL)
  );

-- ============================================================
-- 4. Tabla capacity_slots — capacidad por slot/día/zona
-- ============================================================
CREATE TABLE IF NOT EXISTS capacity_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  zone TEXT,
  slot_type TEXT NOT NULL DEFAULT 'flexible'
    CHECK (slot_type IN ('blocked', 'flexible', 'contingency')),
  max_teams INTEGER NOT NULL DEFAULT 1,
  committed_teams INTEGER NOT NULL DEFAULT 0,
  blocked_reason TEXT,
  is_published BOOLEAN NOT NULL DEFAULT false,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(service_date, start_time, zone)
);

CREATE INDEX IF NOT EXISTS idx_capacity_slots_date ON capacity_slots(service_date);
CREATE INDEX IF NOT EXISTS idx_capacity_slots_zone ON capacity_slots(zone);
CREATE INDEX IF NOT EXISTS idx_capacity_slots_published ON capacity_slots(is_published);

ALTER TABLE capacity_slots ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Public read published capacity slots" ON capacity_slots
  FOR SELECT USING (is_published = true OR is_supervisor(auth.uid()));
CREATE POLICY IF NOT EXISTS "Supervisors manage capacity slots" ON capacity_slots
  FOR ALL USING (is_supervisor(auth.uid())) WITH CHECK (is_supervisor(auth.uid()));

-- ============================================================
-- 5. Tabla dispatch_runs — corridas del scheduler de auto-asignación
-- ============================================================
CREATE TABLE IF NOT EXISTS dispatch_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date DATE NOT NULL,
  phase TEXT NOT NULL
    CHECK (phase IN ('proposal', 'cutoff', 'published', 'simulation', 'crisis_fallback')),
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  auto_approved BOOLEAN NOT NULL DEFAULT false,
  teams_available INTEGER NOT NULL DEFAULT 0,
  orders_processed INTEGER NOT NULL DEFAULT 0,
  orders_assigned INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dispatch_runs_date_phase ON dispatch_runs(run_date, phase);

ALTER TABLE dispatch_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Supervisors read dispatch runs" ON dispatch_runs
  FOR SELECT USING (is_supervisor(auth.uid()));
CREATE POLICY IF NOT EXISTS "Service role insert dispatch runs" ON dispatch_runs
  FOR INSERT WITH CHECK (true);

-- ============================================================
-- 6. Tabla no_show_logs — trazabilidad de no-shows y recuperación
-- ============================================================
CREATE TABLE IF NOT EXISTS no_show_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  grace_until TIMESTAMPTZ NOT NULL,
  recovered_at TIMESTAMPTZ,
  recovery_assignment_id UUID REFERENCES assignments(id) ON DELETE SET NULL,
  client_notified_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'recovered', 'unrecovered', 'cancelled')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_no_show_logs_order ON no_show_logs(order_id);
CREATE INDEX IF NOT EXISTS idx_no_show_logs_status ON no_show_logs(status);

ALTER TABLE no_show_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Supervisors read no show logs" ON no_show_logs
  FOR SELECT USING (is_supervisor(auth.uid()));

-- ============================================================
-- 7. Tabla field_audits ya existe (M7); la extendemos para dispatch probabilístico
-- ============================================================
ALTER TABLE field_audits
  ADD COLUMN IF NOT EXISTS dispatch_probability NUMERIC(4,3) DEFAULT 0.0,
  ADD COLUMN IF NOT EXISTS client_announced BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS client_announced_at TIMESTAMPTZ;

-- ============================================================
-- 8. Funciones de capacidad y HHE
-- ============================================================

-- Calcula N mínimo/máximo de equipos según HHE y horario base/contingencia del empleado
CREATE OR REPLACE FUNCTION calculate_team_size(
  p_hhe_hours NUMERIC,
  p_base_schedule_minutes INTEGER DEFAULT 480,
  p_contingency_minutes INTEGER DEFAULT 120
)
RETURNS TABLE(min_teams INTEGER, max_teams INTEGER, blocked_time_minutes INTEGER)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_total_minutes INTEGER := p_base_schedule_minutes + p_contingency_minutes;
BEGIN
  -- Tiempo bloqueado: HHE convertido a minutos, nunca más que el día laboral
  blocked_time_minutes := LEAST(CEIL(p_hhe_hours * 60)::INTEGER, v_total_minutes);

  -- N máximo: equipos necesarios para terminar dentro del horario base
  max_teams := GREATEST(1, CEIL(blocked_time_minutes::NUMERIC / p_base_schedule_minutes)::INTEGER);

  -- N mínimo: al menos 1, y nunca más que el máximo
  min_teams := 1;
  IF max_teams < min_teams THEN
    max_teams := min_teams;
  END IF;

  RETURN NEXT;
END;
$$;

-- Verifica si un cliente puede reservar "mañana" respetando el corte de las 5:00 PM
CREATE OR REPLACE FUNCTION can_book_tomorrow(p_target_date DATE)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_now TIMESTAMPTZ := now() AT TIME ZONE 'America/Vancouver';
  v_today DATE := (v_now)::DATE;
  v_cutoff TIMESTAMPTZ := (v_today || ' 17:00:00')::TIMESTAMPTZ AT TIME ZONE 'America/Vancouver';
BEGIN
  IF p_target_date > v_today THEN
    RETURN v_now < v_cutoff;
  END IF;
  RETURN true;
END;
$$;

-- Incrementa el contador de no-show del cliente de forma segura
CREATE OR REPLACE FUNCTION increment_no_show_count(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE client_profiles
  SET no_show_count = no_show_count + 1,
      updated_at = now()
  WHERE user_id = p_user_id;
END;
$$;

-- Cuenta equipos disponibles para una fecha
CREATE OR REPLACE FUNCTION available_teams_for_date(p_service_date DATE)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_total INTEGER;
  v_committed INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_total
  FROM employees
  WHERE is_active = true AND role IN ('cleaner', 'supervisor');

  SELECT COALESCE(SUM(committed_teams), 0) INTO v_committed
  FROM capacity_slots
  WHERE service_date = p_service_date;

  RETURN GREATEST(0, v_total - v_committed);
END;
$$;

-- ============================================================
-- 9. Trigger: publicar slots automáticamente a las 5:30 PM
-- ============================================================
CREATE OR REPLACE FUNCTION publish_slots_for_tomorrow()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_tomorrow DATE;
BEGIN
  v_tomorrow := (now() AT TIME ZONE 'America/Vancouver' + INTERVAL '1 day')::DATE;

  UPDATE capacity_slots
  SET is_published = true,
      published_at = now(),
      updated_at = now()
  WHERE service_date = v_tomorrow
    AND is_published = false;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_publish_slots ON dispatch_runs;
CREATE TRIGGER trg_publish_slots
  AFTER INSERT ON dispatch_runs
  FOR EACH ROW
  WHEN (NEW.phase = 'published')
  EXECUTE FUNCTION publish_slots_for_tomorrow();

-- ============================================================
-- 10. Actualizar RLS de assignments: supervisores ya pueden gestionar (migración 017)
-- ============================================================
CREATE POLICY IF NOT EXISTS "Supervisors manage assignments" ON assignments
  FOR ALL USING (is_supervisor(auth.uid())) WITH CHECK (is_supervisor(auth.uid()));

-- ============================================================
-- 11. Feature flag para módulo 3 completo
-- ============================================================
INSERT INTO feature_flags (nombre, activo, modulo, descripcion)
VALUES ('modulo_3_capacity_dispatch', true, 'Módulo 3', 'Capacidad, slots, auto-dispatch, vehículos y no-show')
ON CONFLICT (nombre) DO UPDATE SET activo = true;

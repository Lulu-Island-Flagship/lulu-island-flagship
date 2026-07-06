-- Tablas para Módulo 3: Capacidad y Despacho Orquestado
-- Ejecutar en SQL Editor de Supabase

-- ============================================================
-- 1. Tabla employees (perfil del empleado)
-- ============================================================
CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  role TEXT NOT NULL CHECK (role IN ('cleaner', 'supervisor', 'driver')),
  day_rate INTEGER NOT NULL DEFAULT 200,  -- $CAD diarios (modelo 70/30)
  languages TEXT[] DEFAULT ARRAY['en'],
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: empleados solo pueden ver/editar su propio perfil
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees read own profile" ON employees
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Employees update own profile" ON employees
  FOR UPDATE USING (auth.uid() = user_id);

-- Supervisores pueden ver todos los empleados
CREATE POLICY "Supervisors read all employees" ON employees
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM employees e WHERE e.user_id = auth.uid() AND e.role = 'supervisor'
    )
  );

-- ============================================================
-- 2. Tabla assignments (asignación de servicios a empleados)
-- ============================================================
CREATE TABLE IF NOT EXISTS assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'en_route', 'arrived', 'in_progress', 'completed', 'cancelled', 'no_show')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índice para buscar asignaciones por empleado + fecha
CREATE INDEX IF NOT EXISTS idx_assignments_employee ON assignments(employee_id);
CREATE INDEX IF NOT EXISTS idx_assignments_order ON assignments(order_id);
CREATE INDEX IF NOT EXISTS idx_assignments_status ON assignments(status);

ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;

-- Empleados ven solo sus asignaciones
CREATE POLICY "Employees read own assignments" ON assignments
  FOR SELECT USING (
    employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
  );

-- Empleados pueden actualizar sus propias asignaciones
CREATE POLICY "Employees update own assignments" ON assignments
  FOR UPDATE USING (
    employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
  );

-- Supervisores pueden ver todas las asignaciones
CREATE POLICY "Supervisors read all assignments" ON assignments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM employees e WHERE e.user_id = auth.uid() AND e.role = 'supervisor'
    )
  );

-- ============================================================
-- 3. Tabla service_logs (registro de eventos de servicio)
-- ============================================================
CREATE TABLE IF NOT EXISTS service_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('jornada_start', 'jornada_end', 't_in', 't_start', 't_out', 'photo', 'note')),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  location_lat DOUBLE PRECISION,
  location_lng DOUBLE PRECISION,
  photo_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_logs_order ON service_logs(order_id);
CREATE INDEX IF NOT EXISTS idx_service_logs_employee ON service_logs(employee_id);
CREATE INDEX IF NOT EXISTS idx_service_logs_event ON service_logs(event_type);

ALTER TABLE service_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees read own logs" ON service_logs
  FOR SELECT USING (
    employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
  );

CREATE POLICY "Employees insert own logs" ON service_logs
  FOR INSERT WITH CHECK (
    employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
  );

CREATE POLICY "Supervisors read all logs" ON service_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM employees e WHERE e.user_id = auth.uid() AND e.role = 'supervisor'
    )
  );

-- ============================================================
-- 4. Feature flag para Módulo 3
-- ============================================================
INSERT INTO feature_flags (nombre, activo, modulo, descripcion)
VALUES ('modulo_3_empleado', true, 'Módulo 3', 'PWA del empleado — login, jornada, ejecución de servicios')
ON CONFLICT (nombre) DO UPDATE SET activo = true;

-- ============================================================
-- 5. Bucket de Storage para fotos de servicio
-- ============================================================
-- Crear bucket 'service-photos' con políticas de acceso
-- (Ejecutar en Storage > Buckets de Supabase Dashboard, o usar la API)

-- Nota: El bucket debe crearse manualmente en el Dashboard de Supabase
-- con las siguientes políticas:
-- - Upload: authenticated users can upload to their own folder
-- - Read: authenticated users can read from service-photos bucket
-- - Folder structure: service-photos/{order_id}/{timestamp}.jpg

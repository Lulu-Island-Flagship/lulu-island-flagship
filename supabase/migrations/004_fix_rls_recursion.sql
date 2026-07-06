-- Fix: eliminar políticas con recursión infinita y recrearlas usando función SECURITY DEFINER
-- Ejecutar en SQL Editor de Supabase (después de haber corrido 003_modulo3_employee_tables.sql)

-- ============================================================
-- 1. Crear función helper si no existe (SECURITY DEFINER evita RLS recursivo)
-- ============================================================
CREATE OR REPLACE FUNCTION is_supervisor(user_uuid UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM employees e WHERE e.user_id = user_uuid AND e.role = 'supervisor'
  );
END;
$$;

-- ============================================================
-- 2. Eliminar políticas viejas con recursión en employees
-- ============================================================
DROP POLICY IF EXISTS "Supervisors read all employees" ON employees;

-- Recrear sin recursión (usa función helper)
CREATE POLICY "Supervisors read all employees" ON employees
  FOR SELECT USING (is_supervisor(auth.uid()));

-- ============================================================
-- 3. Eliminar políticas viejas con recursión en assignments
-- ============================================================
DROP POLICY IF EXISTS "Supervisors read all assignments" ON assignments;

-- Recrear sin recursión
CREATE POLICY "Supervisors read all assignments" ON assignments
  FOR SELECT USING (is_supervisor(auth.uid()));

-- ============================================================
-- 4. Eliminar políticas viejas con recursión en service_logs
-- ============================================================
DROP POLICY IF EXISTS "Supervisors read all logs" ON service_logs;

-- Recrear sin recursión
CREATE POLICY "Supervisors read all logs" ON service_logs
  FOR SELECT USING (is_supervisor(auth.uid()));

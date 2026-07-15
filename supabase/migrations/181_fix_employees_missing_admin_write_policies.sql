-- Migración 181 — ROUND 2, hallazgo más crítico de esta auditoría.
--
-- `employees` (migración 003) NUNCA tuvo una política de INSERT para NADIE,
-- y su única política de UPDATE es "Employees update own profile" (USING
-- auth.uid() = user_id) -- un empleado editando su propia fila. No existe,
-- en ninguna migración de todo el repo, una política que permita a un
-- supervisor/admin insertar o actualizar la fila de OTRO empleado.
--
-- Esto significa que, tal como estaba el sistema, absolutamente ninguna
-- escritura administrativa sobre `employees` podía funcionar contra la base
-- de datos real (fallaban con una violación de RLS, no con un error de
-- lógica):
--   - POST /api/admin/empleados (FIX-10, esta sesión): el INSERT del
--     empleado nuevo durante onboarding.
--   - POST /api/admin/empleados/[id]/offboard (FIX-11, esta sesión): el
--     UPDATE de is_active/terminated_at/termination_reason.
--   - PATCH /api/admin/empleados/[id] (sesión concurrente anterior): el
--     UPDATE de career_level/languages/language_levels.
--   - Cualquier futuro endpoint admin que edite Day Rate, rol, vehicle_id, etc.
--
-- (El cron semanal de scores SÍ queda a salvo porque esta misma auditoría
-- lo migró a un cliente de service role, que ignora RLS por diseño -- pero
-- ese es el único camino de escritura a `employees` que funcionaba.)
--
-- Fix: agregar las dos políticas de supervisor/admin que faltaban, mismo
-- patrón (is_supervisor(auth.uid()), que ya incluye owner_admin y
-- ops_coordinator vía has_admin_role desde la migración 040) usado en cada
-- otra tabla administrativa del sistema.

DROP POLICY IF EXISTS "Supervisors insert employees" ON employees;
CREATE POLICY "Supervisors insert employees" ON employees
  FOR INSERT WITH CHECK (is_supervisor(auth.uid()));

DROP POLICY IF EXISTS "Supervisors update employees" ON employees;
CREATE POLICY "Supervisors update employees" ON employees
  FOR UPDATE USING (is_supervisor(auth.uid()));

COMMENT ON TABLE employees IS
  'v8.3 migración 181: además de que cada empleado puede leer/editar su propia fila, un supervisor/owner_admin/ops_coordinator (is_supervisor(auth.uid())) puede insertar y actualizar cualquier fila -- requerido para onboarding, offboarding, promociones de carrera y cualquier edición administrativa. Antes de esta migración, NINGUNA de esas escrituras podía llegar a la base de datos real.';

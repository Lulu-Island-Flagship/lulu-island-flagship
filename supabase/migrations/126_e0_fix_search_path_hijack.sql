-- v8.3 E0 — Cierra un hueco de seguridad real (segunda auditoría, 2026-07-11):
-- has_admin_role() e is_supervisor(), definidas en 040_e0_admin_rbac.sql, son
-- SECURITY DEFINER pero NUNCA fijaron SET search_path. Toda otra función
-- SECURITY DEFINER del repo sí lo hace (001_modulo1_base_schema.sql,
-- 003_modulo3_employee_tables.sql, 004_fix_rls_recursion.sql). Como 040
-- redefine is_supervisor() con la MISMA firma que la de 003, la reemplazó
-- silenciosamente y se llevó esa protección con ella.
--
-- Por qué importa: sin SET search_path, una función SECURITY DEFINER que
-- referencia tablas sin calificar (admin_roles, employees) resuelve esos
-- nombres según el search_path de QUIEN LLAMA, no del dueño de la función.
-- Un usuario autenticado podría crear un schema propio con una tabla
-- "admin_roles" falsa y, si logra que su search_path se evalúe antes que
-- "public" en el contexto de la llamada, hacer que estas funciones -que
-- corren con los privilegios del dueño (normalmente postgres)- lean de su
-- tabla falsa en vez de la real. Fijar SET search_path = public elimina esa
-- ambigüedad: las funciones SIEMPRE resuelven admin_roles/employees contra
-- el esquema public real, sin importar qué search_path traiga quien llama.
--
-- No cambia ningún comportamiento observable hoy (las tablas reales viven en
-- public y search_path por defecto ya es public) -- es puro endurecimiento.

CREATE OR REPLACE FUNCTION has_admin_role(user_uuid UUID, roles TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM admin_roles
    WHERE user_id = user_uuid
      AND role = ANY(roles)
      AND deleted_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION is_supervisor(user_uuid UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM employees
    WHERE user_id = user_uuid AND role = 'supervisor' AND is_active = true
  )
  OR has_admin_role(user_uuid, ARRAY['owner_admin', 'ops_coordinator']);
$$;

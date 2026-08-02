-- Fix auditoría de seguridad externa (2026-08-02): is_supervisor(uuid) no
-- filtraba `deleted_at IS NULL` en la tabla employees, a diferencia de
-- has_admin_role(uuid, text[]) que sí lo hace sobre admin_roles (ver
-- definición actual, verificada en producción eadgocbmfnqfpgvoutvp vía
-- pg_get_functiondef):
--
--   CREATE OR REPLACE FUNCTION public.is_supervisor(user_uuid uuid)
--    RETURNS boolean
--    LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
--   AS $function$
--     SELECT EXISTS (
--       SELECT 1 FROM employees
--       WHERE user_id = user_uuid AND role = 'supervisor' AND is_active = true
--     )
--     OR has_admin_role(user_uuid, ARRAY['owner_admin', 'ops_coordinator']);
--   $function$
--
-- is_supervisor() es SECURITY DEFINER y se usa como guard interno en varias
-- RPC sensibles (ej. receive_purchase_order, ver migración 316) y en
-- políticas RLS ("Supervisors read/manage ..." en decenas de tablas). El
-- offboarding de un empleado (ver migración 305,
-- offboard_employee_atomic) marca employees.deleted_at pero el código de
-- offboarding depende de is_active=false para desactivar accesos; si algún
-- flujo de reactivación o un registro legado deja is_active=true en una fila
-- con deleted_at ya seteado (soft-deleted), is_supervisor() seguiría
-- devolviendo TRUE para ese user_id -- un supervisor offboardeado
-- conservaría privilegios de supervisor en RLS y en las RPC que dependen de
-- este guard. has_admin_role ya se protege de este mismo escenario exigiendo
-- deleted_at IS NULL; is_supervisor debe exigir lo mismo sobre employees.
--
-- Se replica exactamente la lógica existente (mismo SECURITY DEFINER,
-- mismo search_path, misma llamada a has_admin_role) y solo se añade el
-- filtro `deleted_at IS NULL` a la subconsulta de employees.

CREATE OR REPLACE FUNCTION public.is_supervisor(user_uuid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM employees
    WHERE user_id = user_uuid
      AND role = 'supervisor'
      AND is_active = true
      AND deleted_at IS NULL
  )
  OR has_admin_role(user_uuid, ARRAY['owner_admin', 'ops_coordinator']);
$function$;

COMMENT ON FUNCTION public.is_supervisor(uuid) IS
  'Fix auditoría de seguridad externa (migración 318, 2026-08-02): añade '
  '`deleted_at IS NULL` al chequeo sobre employees -- antes un supervisor '
  'soft-deleted (offboardeado) con is_active aún en true conservaba privilegios '
  'de supervisor en cualquier RLS/RPC que dependiera de esta función. Replica '
  'exactamente la definición previa (mismo SECURITY DEFINER, search_path y '
  'llamada a has_admin_role), que ya exige deleted_at IS NULL sobre admin_roles.';

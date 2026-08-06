-- Migration 361: Revoke EXECUTE on set_current_fixed_costs from PUBLIC/anon
-- Auditoría 2026-08-06: la migración 295 dejó la función
-- set_current_fixed_costs con EXECUTE grant a PUBLIC (comportamiento por
-- defecto de CREATE FUNCTION). Si bien la función tiene un guard interno
-- has_admin_role(auth.uid(), ARRAY['owner_admin']), exponerla a llamadas
-- anónimas es inconsistente con la política del proyecto (ver migración 316
-- que aplicó el mismo fix para otras 3 RPCs). Se sigue el mismo patrón:
-- revoke de PUBLIC/anon, grant solo a authenticated + service_role.
--
-- NOTA: el grant a `authenticated` es necesario porque la función se llama
-- desde el panel admin (contabilidad), donde el usuario tiene sesión de
-- Supabase como authenticated. El guard interno sigue siendo la única
-- fuente de autorización real (rol owner_admin).

BEGIN;

REVOKE EXECUTE ON FUNCTION set_current_fixed_costs FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_current_fixed_costs TO authenticated, service_role;

COMMIT;

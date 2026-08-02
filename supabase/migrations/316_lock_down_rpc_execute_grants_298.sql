-- Fix auditoría de seguridad externa (2026-08-02): las 3 funciones RPC
-- recreadas en la migración 298 (apply_payroll_cycle_deduction,
-- receive_purchase_order, set_current_pricing_settings) se crearon con
-- CREATE OR REPLACE sin ningún REVOKE/GRANT explícito de EXECUTE. Postgres
-- otorga EXECUTE a PUBLIC por defecto en toda función nueva salvo que se
-- revoque -- mismo patrón de hallazgo ya corregido en la migración 300 para
-- increment_disputes_lost_count / increment_no_show_count /
-- generate_review_token / increment_client_services_count.
--
-- Verificación contra producción (eadgocbmfnqfpgvoutvp, 2026-08-02) vía
-- information_schema.routine_privileges: las 3 funciones tenían EXECUTE
-- otorgado a PUBLIC, anon, authenticated, postgres y service_role -- es
-- decir, cualquier request con la anon key (sin sesión) podía invocarlas
-- directamente con supabase.rpc(...).
--
-- Verificación (grep sobre src/**/*.ts, 2026-08-02) de quién llama cada
-- función vía `.rpc(...)`:
--
--   apply_payroll_cycle_deduction
--     -> solo src/app/api/admin/payroll-export/route.ts, vía
--        requireAdminRole("payroll") + auth.supabase (cliente de SESIÓN del
--        admin autenticado, no service_role). LANGUAGE plpgsql sin
--        SECURITY DEFINER (invoker por defecto): corre con las políticas RLS
--        del caller -- "Supervisors manage cycle deductions"/"Supervisors
--        manage payroll ytd" (migración 052) ya restringen quién puede
--        escribir estas tablas, así que exponerla a `authenticated` es
--        seguro (RLS sigue aplicando). Se revoca de anon/PUBLIC: un usuario
--        sin sesión no debe poder invocarla en absoluto (y si la invoca, las
--        políticas RLS de las tablas subyacentes de todas formas la
--        bloquearían al no cumplir auth.uid(), pero no debe ni poder
--        intentarlo).
--
--   receive_purchase_order
--     -> solo src/app/api/admin/purchase-orders/[id]/approve/route.ts, vía
--        requireAdminRole + auth.supabase (cliente de sesión). SECURITY
--        DEFINER con guard interno `IF NOT is_supervisor(auth.uid())`. Se
--        revoca EXECUTE de anon/PUBLIC (sin sesión no hay auth.uid(), el
--        guard igual la bloquearía pero no debe estar expuesta) y se
--        mantiene el grant a `authenticated` (el guard interno ya restringe
--        a supervisores reales) + `service_role`.
--
--   set_current_pricing_settings
--     -> solo src/app/api/admin/pricing-settings/route.ts, vía
--        requireAdminRole + auth.supabase (cliente de sesión). SECURITY
--        DEFINER con guard interno `IF NOT has_admin_role(auth.uid(),
--        ARRAY['owner_admin'])`. Mismo tratamiento: revoca de anon/PUBLIC,
--        mantiene `authenticated` (el guard interno exige owner_admin) +
--        `service_role`.
--
-- Ninguna de las tres se invoca jamás con la anon key (sin sesión) ni sin
-- guard de rol -- por eso el grant final es `authenticated` (no solo
-- `service_role`): las tres validan el rol internamente (vía RLS invoker o
-- vía chequeo explícito SECURITY DEFINER), así que restringir a
-- `service_role` únicamente rompería el flujo real de admin/supervisor
-- autenticado desde el navegador.

REVOKE EXECUTE ON FUNCTION apply_payroll_cycle_deduction(
  UUID, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER,
  INTEGER, INTEGER, BOOLEAN, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER,
  INTEGER, INTEGER, INTEGER
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION apply_payroll_cycle_deduction(
  UUID, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER,
  INTEGER, INTEGER, BOOLEAN, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER,
  INTEGER, INTEGER, INTEGER
) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION receive_purchase_order(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION receive_purchase_order(UUID) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION set_current_pricing_settings(NUMERIC, DATE, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_current_pricing_settings(NUMERIC, DATE, TEXT, UUID) TO authenticated, service_role;

COMMENT ON FUNCTION apply_payroll_cycle_deduction(
  UUID, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER,
  INTEGER, INTEGER, BOOLEAN, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER,
  INTEGER, INTEGER, INTEGER
) IS
  'Fix auditoría de seguridad externa (migración 316, 2026-08-02): EXECUTE revocado de PUBLIC/anon -- '
  'quedaba expuesta por default de Postgres tras la migración 298. Permanece otorgada a `authenticated` '
  'porque el flujo real (src/app/api/admin/payroll-export/route.ts) la invoca con la sesión del admin, y '
  'es SECURITY INVOKER: las políticas RLS de payroll_cycle_deductions/payroll_ytd ya restringen la '
  'escritura a supervisores.';

COMMENT ON FUNCTION receive_purchase_order(UUID) IS
  'Fix (auditoría de integridad financiera, migración 247) + Fix auditoría de seguridad externa '
  '(migración 316, 2026-08-02): EXECUTE revocado de PUBLIC/anon -- quedaba expuesta por default de '
  'Postgres tras recrearse en la migración 298. Permanece otorgada a `authenticated` porque el guard '
  'interno `is_supervisor(auth.uid())` ya restringe quién puede recibir una orden de compra.';

COMMENT ON FUNCTION set_current_pricing_settings(NUMERIC, DATE, TEXT, UUID) IS
  'Fix (auditoría de integridad financiera, migración 250) + Fix auditoría de seguridad externa '
  '(migración 316, 2026-08-02): EXECUTE revocado de PUBLIC/anon -- quedaba expuesta por default de '
  'Postgres tras recrearse en la migración 298. Permanece otorgada a `authenticated` porque el guard '
  'interno `has_admin_role(auth.uid(), ARRAY[''owner_admin''])` ya restringe quién puede editar la '
  'tarifa objetivo.';

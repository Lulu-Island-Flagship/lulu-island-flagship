-- Fix Kimi-C2 (auditoría externa Kimi Code, 2026-07-21, verificado por Claude
-- antes de aplicar -- el reporte de Kimi citaba el archivo inexistente
-- "165_finance_module.sql"; las tablas reales están repartidas en 021, 024,
-- 025, 074).
--
-- Se hizo un barrido completo (grep de "WITH CHECK (true)" en todas las
-- migraciones) y se encontraron 11 políticas -- no solo las 2 que Kimi
-- señaló -- que permiten INSERT (o, en un caso, INSERT/UPDATE/DELETE) SIN
-- ninguna restricción de rol ni condición. El patrón se llamó "System
-- insert X" pensando en que solo procesos server-side (service_role)
-- escribirían ahí, pero una política sin cláusula TO restringe por rol
-- aplica a TODOS los roles, incluido `authenticated` -- cualquier usuario
-- logueado podía insertar (o, en cron_execution_guard, también actualizar/
-- borrar) filas arbitrarias directo desde el cliente vía supabase-js,
-- saltándose toda la lógica de la aplicación.
--
-- Verificado ANTES de aplicar (grep completo de src/, 2026-07-21): las
-- únicas escrituras reales a estas 11 tablas en todo el repo están en rutas
-- /api/admin/*, /api/cron/*, y /api/stripe/webhook -- todas usan
-- SUPABASE_SERVICE_ROLE_KEY (confirmado archivo por archivo). El
-- service_role de Supabase tiene BYPASSRLS y no depende de estas políticas
-- para escribir -- por lo tanto, ELIMINAR estas políticas no rompe ningún
-- flujo real, solo cierra la puerta que quedaba abierta para
-- `authenticated`/`anon`.
--
-- Excepción a propósito (NO se toca): "Allow anonymous inserts" en
-- analytics_events (013_analytics_events_table.sql) -- esa sí declara
-- explícitamente TO anon, authenticated y fue confirmada como intencional
-- en la migración 129_e0_narrow_anon_grants.sql (tracking de eventos sin
-- sesión es el propósito de la tabla).
--
-- Tablas corregidas en esta migración:
--   1. wallet_transactions        (025) -- ya cubierto en parte por el fix
--      de ownership de apply_wallet_delta (233), pero el INSERT directo
--      (bypaseando el RPC) seguía abierto.
--   2. payroll_entries            (021)
--   3. chargeback_reserves        (024)
--   4. cash_tax_reserve_ledger    (074)
--   5. cash_exposure_alerts       (074)
--   6. dispatch_runs              (026)
--   7. payment_recovery_notifications (073)
--   8. contract_ipc_adjustments   (075)
--   9. contract_ipc_notices       (075)
--  10. cron_execution_guard       (073) -- esta era la más grave: FOR ALL
--      USING(true) WITH CHECK(true), es decir SELECT/INSERT/UPDATE/DELETE
--      sin restricción -- cualquier usuario autenticado podía manipular el
--      guard de deduplicación de crons y forzar re-ejecuciones o bloquear
--      un cron indefinidamente.
--
-- NOTA: contract_instances (022) tenía el mismo problema, pero la
-- migración 184_drop_superseded_orphan_tables.sql ya eliminó esa tabla por
-- completo (deuda técnica abandonada, ver 183) -- no queda nada que
-- corregir ahí, la tabla ni siquiera existe hoy.

DROP POLICY IF EXISTS "System insert wallet transactions" ON wallet_transactions;
DROP POLICY IF EXISTS "System insert payroll" ON payroll_entries;
DROP POLICY IF EXISTS "System insert chargeback reserves" ON chargeback_reserves;
DROP POLICY IF EXISTS "System insert tax reserve ledger" ON cash_tax_reserve_ledger;
DROP POLICY IF EXISTS "System insert cash exposure alerts" ON cash_exposure_alerts;
DROP POLICY IF EXISTS "Service role insert dispatch runs" ON dispatch_runs;
DROP POLICY IF EXISTS "System insert payment recovery notifications" ON payment_recovery_notifications;
DROP POLICY IF EXISTS "System insert contract IPC adjustments" ON contract_ipc_adjustments;
DROP POLICY IF EXISTS "System insert contract IPC notices" ON contract_ipc_notices;
DROP POLICY IF EXISTS "System manage cron guard" ON cron_execution_guard;

COMMENT ON TABLE wallet_transactions IS
  'Fix Kimi-C2 (migración 234, 2026-07-21): sin política de INSERT para authenticated/anon -- solo service_role (BYPASSRLS) o la RPC apply_wallet_delta (migración 233, con validación de dueño) pueden escribir aquí.';
COMMENT ON TABLE payroll_entries IS
  'Fix Kimi-C2 (migración 234, 2026-07-21): sin política de INSERT para authenticated/anon -- solo service_role (BYPASSRLS, rutas /api/admin/* y /api/cron/*) puede escribir aquí.';
COMMENT ON TABLE chargeback_reserves IS
  'Fix Kimi-C2 (migración 234, 2026-07-21): sin política de INSERT para authenticated/anon -- solo service_role puede escribir aquí.';
COMMENT ON TABLE cash_tax_reserve_ledger IS
  'Fix Kimi-C2 (migración 234, 2026-07-21): sin política de INSERT para authenticated/anon -- solo service_role puede escribir aquí.';
COMMENT ON TABLE cash_exposure_alerts IS
  'Fix Kimi-C2 (migración 234, 2026-07-21): sin política de INSERT para authenticated/anon -- solo service_role puede escribir aquí.';
COMMENT ON TABLE dispatch_runs IS
  'Fix Kimi-C2 (migración 234, 2026-07-21): sin política de INSERT para authenticated/anon -- solo service_role puede escribir aquí.';
COMMENT ON TABLE payment_recovery_notifications IS
  'Fix Kimi-C2 (migración 234, 2026-07-21): sin política de INSERT para authenticated/anon -- solo service_role puede escribir aquí.';
COMMENT ON TABLE contract_ipc_adjustments IS
  'Fix Kimi-C2 (migración 234, 2026-07-21): sin política de INSERT para authenticated/anon -- solo service_role puede escribir aquí.';
COMMENT ON TABLE contract_ipc_notices IS
  'Fix Kimi-C2 (migración 234, 2026-07-21): sin política de INSERT para authenticated/anon -- solo service_role puede escribir aquí.';
COMMENT ON TABLE cron_execution_guard IS
  'Fix Kimi-C2 (migración 234, 2026-07-21): sin ninguna política para authenticated/anon (antes FOR ALL USING(true) WITH CHECK(true)) -- solo service_role puede leer/escribir el guard de deduplicación de crons.';

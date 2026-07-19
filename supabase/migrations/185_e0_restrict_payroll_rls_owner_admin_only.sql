-- v8.3 E0 — Fix RBAC roto en RLS (auditoría 2026-07-18):
-- ops_coordinator podía leer payroll_entries/payroll_settings directo vía
-- RLS, aunque a nivel de API estos recursos son owner_admin-only.
--
-- Origen del hueco: 021_modulo2_payroll.sql:68-96 usa is_supervisor(auth.uid())
-- para las políticas SELECT de payroll_entries y payroll_settings.
-- is_supervisor() (definida en 040_e0_admin_rbac.sql, search_path fijado en
-- 126) incluye owner_admin Y ops_coordinator (via has_admin_role(...,
-- ARRAY['owner_admin','ops_coordinator'])). Eso contradice src/lib/admin-rbac.ts,
-- donde `payroll: ["owner_admin"]` -- las rutas API (/api/admin/payroll-export,
-- /api/admin/accounting, /api/admin/economic-params via "finance"/"payroll")
-- YA bloquean a ops_coordinator correctamente, pero cualquier lectura directa
-- contra la tabla (Supabase client-side, REST, RPC ad-hoc) se saltaba ese
-- bloqueo porque RLS era más permisiva que la capa de API.
--
-- Por qué NO tocamos is_supervisor() en sí ni la política SELECT de
-- `employees` (004_fix_rls_recursion.sql:26-27): se verificó el uso real en
-- código antes de tocar nada (ver src/app/api/admin/dispatch/route.ts:273-277).
-- El endpoint GET /api/admin/dispatch -- recurso "dispatch", permitido para
-- ops_coordinator en admin-rbac.ts -- lee employees.day_rate legítimamente
-- para clasificar el modelo 70/30 y calcular el pago garantizado de la
-- Ventana de Contingencia (schedule-7030.ts) directamente vía el cliente
-- RLS-scoped del usuario (requireAdminRole -> getSupabaseClient(), NO
-- service role). Restringir la política SELECT de `employees` a solo
-- owner_admin habría roto esa pantalla de despacho para ops_coordinator, que
-- SÍ tiene negocio legítimo viendo day_rate ahí (no es un caso de "columna
-- sensible filtrada por accidente" -- 040_e0_admin_rbac.sql:82-83 ya deja
-- constancia explícita de que la única exclusión intencional de
-- employees/day_rate es para el rol qc_only, no para ops_coordinator).
-- RLS de Postgres es row-level, no column-level, así que no hay forma de
-- exponer "employees sin day_rate" a ops_coordinator sin una vista dedicada
-- o privilegios por columna -- ese refactor no está justificado por ningún
-- caller real que necesite bloquear day_rate para ops_coordinator
-- específicamente, así que se documenta como decisión consciente, no deuda.
--
-- payroll_entries y payroll_settings sí son un caso limpio: se confirmó (grep
-- completo de requireAdminRole en src/app/api/admin) que NINGÚN endpoint
-- accesible a ops_coordinator (dispatch, services, quotes_review, tickets,
-- upsells_review, checklists_sop, vehicles, field_audits, risk_assessments,
-- near_misses, inventory, wellbeing, qc_wall) toca estas dos tablas. Todo
-- acceso real pasa por recursos "payroll" o "finance", ambos owner_admin-only.
-- Fix: usar has_admin_role(auth.uid(), ARRAY['owner_admin']) -- ya existe
-- desde 040_e0_admin_rbac.sql, no hace falta una función nueva -- en vez de
-- is_supervisor() para las políticas SELECT/UPDATE/ALL de payroll_entries y
-- payroll_settings. is_supervisor() queda intacta para todo lo demás
-- (assignments, service_logs, employees, etc.), donde ops_coordinator sí
-- tiene negocio legítimo.

DROP POLICY IF EXISTS "Supervisors read all payroll" ON payroll_entries;
CREATE POLICY "Owner admin reads all payroll" ON payroll_entries
  FOR SELECT USING (has_admin_role(auth.uid(), ARRAY['owner_admin']));

DROP POLICY IF EXISTS "Supervisors update payroll" ON payroll_entries;
CREATE POLICY "Owner admin updates payroll" ON payroll_entries
  FOR UPDATE USING (has_admin_role(auth.uid(), ARRAY['owner_admin']));

DROP POLICY IF EXISTS "Supervisors read payroll settings" ON payroll_settings;
CREATE POLICY "Owner admin reads payroll settings" ON payroll_settings
  FOR SELECT USING (has_admin_role(auth.uid(), ARRAY['owner_admin']));

DROP POLICY IF EXISTS "Supervisors manage payroll settings" ON payroll_settings;
CREATE POLICY "Owner admin manages payroll settings" ON payroll_settings
  FOR ALL USING (has_admin_role(auth.uid(), ARRAY['owner_admin']));

COMMENT ON TABLE payroll_entries IS
  'v8.3 migración 185: SELECT/UPDATE restringidos a owner_admin (has_admin_role), NO is_supervisor() -- ops_coordinator no tiene negocio legítimo viendo nómina (confirmado: ningún endpoint que ops_coordinator puede llamar toca esta tabla). INSERT sigue abierto (System insert payroll, WITH CHECK true) -- lo escribe el sistema al calcular nómina, no un rol admin.';

COMMENT ON TABLE payroll_settings IS
  'v8.3 migración 185: acceso restringido a owner_admin (has_admin_role), NO is_supervisor() -- salario mínimo legal de BC es configuración financiera, no operativa.';

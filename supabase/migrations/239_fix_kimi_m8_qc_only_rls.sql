-- Fix Kimi-M8 (auditoría externa Kimi Code, 2026-07-21, verificado y
-- confirmado real): las políticas RLS de qc_reviews (migración 010) solo
-- comprueban is_supervisor(auth.uid()). is_supervisor() (definición vigente,
-- migración 126) es:
--   employees.role='supervisor' AND is_active=true
--   OR has_admin_role(user_uuid, ARRAY['owner_admin','ops_coordinator'])
-- -- EXCLUYE explícitamente 'qc_only' (ver comentario de la migración 040:
-- "Explícitamente NO se le da acceso a: employees... -- SOLO el muro de
-- evidencia").
--
-- Pero src/lib/admin-rbac.ts SÍ incluye 'qc_only' en el recurso 'qc_wall'
-- (qc_wall: ["owner_admin", "ops_coordinator", "qc_only"]), y
-- admin/qc/route.ts + admin/qc/[orderId]/review/route.ts (las únicas rutas
-- que usan ese recurso) usan el cliente anon+sesión (requireAdminRole ->
-- getSupabaseClient(), sujeto a RLS), NO service_role.
--
-- Resultado: un admin con SOLO admin_roles.role='qc_only' (sin ser
-- employees.role='supervisor' ni tener owner_admin/ops_coordinator) pasa la
-- autorización de la API (requireAdminRole permite qc_only en qc_wall) pero
-- CADA consulta real contra qc_reviews (SELECT del grid, INSERT manual,
-- UPDATE de aprobar/rechazar) queda bloqueada por RLS -- el rol qc_only
-- está completamente roto para el único propósito para el que existe.
--
-- Fix: las 3 políticas de qc_reviews también aceptan
-- has_admin_role(auth.uid(), ARRAY['qc_only']) además de is_supervisor().
-- No se toca is_supervisor() en sí (sigue excluyendo qc_only en TODAS las
-- demás tablas a propósito, ver migración 040 -- qc_only NO debe ver
-- employees/payroll/etc., solo el muro de QC).
DROP POLICY IF EXISTS "Supervisors read all qc" ON qc_reviews;
CREATE POLICY "Supervisors read all qc" ON qc_reviews
  FOR SELECT USING (is_supervisor(auth.uid()) OR has_admin_role(auth.uid(), ARRAY['qc_only']));

DROP POLICY IF EXISTS "Supervisors insert qc" ON qc_reviews;
CREATE POLICY "Supervisors insert qc" ON qc_reviews
  FOR INSERT WITH CHECK (is_supervisor(auth.uid()) OR has_admin_role(auth.uid(), ARRAY['qc_only']));

DROP POLICY IF EXISTS "Supervisors update qc" ON qc_reviews;
CREATE POLICY "Supervisors update qc" ON qc_reviews
  FOR UPDATE USING (is_supervisor(auth.uid()) OR has_admin_role(auth.uid(), ARRAY['qc_only']));

COMMENT ON TABLE qc_reviews IS
  'Fix Kimi-M8 (migración 239, 2026-07-21): políticas RLS ampliadas para aceptar también admin_roles.role=qc_only (antes solo is_supervisor(), que excluye qc_only a propósito -- el fix es específico de esta tabla, no cambia is_supervisor() global).';

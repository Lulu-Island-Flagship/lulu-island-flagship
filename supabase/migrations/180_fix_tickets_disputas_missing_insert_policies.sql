-- Migración 180 — ROUND 2: bug crítico real encontrado auditando el flujo
-- del empleado. tickets_disputas (migración 010) SOLO tenía una política de
-- INSERT: "Supervisors insert tickets" (WITH CHECK is_supervisor(auth.uid())).
--
-- Eso significaba que CUALQUIER insert hecho con la sesión propia de un
-- empleado o de un cliente (no un supervisor) quedaba bloqueado por RLS,
-- incluyendo:
--   - POST /api/empleado/hours-dispute (FIX-9, esta misma sesión): el
--     empleado marca "T incorrecto" -- el insert fallaba con un error de
--     RLS y el endpoint devolvía 500. El canal de disputa de horas nunca
--     funcionó de verdad desde que se construyó unas horas atrás.
--   - POST /api/empleado/upsells cuando un upsell supera el tope del 50%
--     (FIX-6, esta misma sesión): el ticket de aprobación para el admin
--     tampoco se creaba nunca (el insert está en un try/catch silencioso
--     que no revisa el error).
--   - POST /api/client/pre-review-survey ("queja prioritaria con SLA de 4h",
--     E5 #7): un cliente reportando una queja en la encuesta pre-reseña
--     tampoco lograba crear su ticket -- bug preexistente, no de esta sesión.
--
-- Fix: agregar políticas de INSERT explícitas para empleados (su propio
-- employee_id) y para clientes (un order_id que sea realmente suyo), sin
-- tocar la política de supervisores ya existente.

DROP POLICY IF EXISTS "Employees insert own tickets" ON tickets_disputas;
CREATE POLICY "Employees insert own tickets" ON tickets_disputas
  FOR INSERT WITH CHECK (
    employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Clients insert tickets for own orders" ON tickets_disputas;
CREATE POLICY "Clients insert tickets for own orders" ON tickets_disputas
  FOR INSERT WITH CHECK (
    order_id IN (SELECT id FROM orders WHERE user_id = auth.uid())
  );

COMMENT ON TABLE tickets_disputas IS
  'v8.3 migración 180: además de "Supervisors insert tickets" (010), un empleado puede insertar un ticket con su propio employee_id y un cliente puede insertar un ticket para una orden que es realmente suya. Antes de esto, solo un supervisor autenticado podía crear un ticket -- cualquier flujo self-service (disputa de horas, aprobación de upsell, queja pre-reseña) fallaba silenciosamente por RLS.';

-- Mismo bug, mismo hallazgo: field_audits (migración 010) solo tiene
-- "Supervisors update audits" -- POST /api/empleado/appeal (el canal de
-- apelación QC, ventana de 72h) actualiza appealed_at/appeal_reason con la
-- sesión propia del EMPLEADO, no de un supervisor. Ese UPDATE también
-- quedaba bloqueado por RLS: la apelación de un empleado a su score de
-- auditoría nunca se guardaba, el endpoint devolvía 500. Se agrega la
-- política faltante, limitada a que el empleado sea dueño de la fila (no
-- se restringe por columna porque RLS no lo permite nativamente -- la
-- superficie de confianza real sigue siendo el endpoint, que solo envía
-- appealed_at/appeal_reason).
DROP POLICY IF EXISTS "Employees appeal own audits" ON field_audits;
CREATE POLICY "Employees appeal own audits" ON field_audits
  FOR UPDATE USING (
    employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
  );

-- Mismo bug, tercera instancia: service_logs (migración 003) solo tiene
-- "Employees insert own logs" -- ningún supervisor/admin puede insertar ni
-- actualizar un log. POST /api/admin/hours-disputes/[id]/resolve (FIX-9,
-- esta misma sesión) corrige el timestamp corregido (UPDATE) o crea el
-- evento faltante por falla técnica (INSERT) usando la sesión del ADMIN,
-- no la del empleado -- ambas escrituras fallaban por RLS. Se agrega la
-- política de supervisor faltante para INSERT/UPDATE (la de SELECT ya
-- existía desde 003/004).
DROP POLICY IF EXISTS "Supervisors manage service logs" ON service_logs;
CREATE POLICY "Supervisors manage service logs" ON service_logs
  FOR INSERT WITH CHECK (is_supervisor(auth.uid()));

DROP POLICY IF EXISTS "Supervisors update service logs" ON service_logs;
CREATE POLICY "Supervisors update service logs" ON service_logs
  FOR UPDATE USING (is_supervisor(auth.uid()));

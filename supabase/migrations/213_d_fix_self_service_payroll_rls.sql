-- 213_d_fix_self_service_payroll_rls.sql
--
-- v8.3 auditoría 2026-07-21 — hallazgos D-P0-2 y D-P0-3 (críticos).
--
-- Problema: las políticas RLS `FOR ALL` de sick_leave_requests (170) y
-- readiness_requests/payroll_readiness_credits (049, 090) dejaban al
-- empleado escribir, con su propia sesión (anon key), cualquier valor en
-- columnas que determinan dinero real: pay_type, paid_amount_cents,
-- resolution ('full_day_rate'), y filas completas de
-- payroll_readiness_credits. Desde la consola del navegador, un empleado
-- podía autoconcederse pagos arbitrarios sin pasar por la lógica de
-- negocio del servidor.
--
-- Fix: separar INSERT/SELECT/UPDATE en vez de FOR ALL. El empleado sigue
-- pudiendo crear y leer sus propias solicitudes, pero el INSERT está
-- restringido a un estado NO PAGABLE (pay_type <> 'paid',
-- paid_amount_cents NULL; resolution = 'pending'). Las rutas de servidor
-- (sick-leave/route.ts, readiness/route.ts) se actualizan en el mismo
-- cambio para escribir el resultado real de la lógica de negocio con la
-- service-role key (igual que el resto de escrituras confiables del
-- repo), que no está sujeta a RLS. Cualquier escritura que use la anon
-- key -- incluida la consola del navegador -- queda limitada al estado
-- no pagable.
--
-- Idempotente: usa DROP POLICY IF EXISTS antes de cada CREATE.

-- ============================================================
-- sick_leave_requests (170_e3_sick_leave.sql)
-- ============================================================

DROP POLICY IF EXISTS "Employees manage own sick leave requests" ON sick_leave_requests;
DROP POLICY IF EXISTS "Supervisors manage all sick leave requests" ON sick_leave_requests;

-- El empleado puede crear su propia solicitud, pero nunca en estado
-- pagable: pay_type <> 'paid' y paid_amount_cents debe venir NULL. La
-- determinación real de "paid" y el monto correcto (día completo en
-- centavos, con piso salarial de BC) los escribe el servidor con
-- service-role key, fuera de RLS.
CREATE POLICY "Employees insert own sick leave requests" ON sick_leave_requests
  FOR INSERT
  WITH CHECK (
    employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
    AND pay_type <> 'paid'
    AND paid_amount_cents IS NULL
  );

CREATE POLICY "Employees select own sick leave requests" ON sick_leave_requests
  FOR SELECT
  USING (employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid()));

CREATE POLICY "Supervisors select all sick leave requests" ON sick_leave_requests
  FOR SELECT
  USING (is_supervisor(auth.uid()));

-- Solo owner_admin puede modificar una solicitud ya creada (aprobar nota
-- médica, corregir pay_type/paid_amount_cents, acknowledged_by/at).
CREATE POLICY "Owner admin update sick leave requests" ON sick_leave_requests
  FOR UPDATE
  USING (has_admin_role(auth.uid(), ARRAY['owner_admin']))
  WITH CHECK (has_admin_role(auth.uid(), ARRAY['owner_admin']));

-- ============================================================
-- readiness_requests (049_e8_employee_wellbeing.sql)
-- ============================================================

DROP POLICY IF EXISTS "Employees manage own readiness requests" ON readiness_requests;

-- El empleado puede crear su propia solicitud, pero siempre nace
-- 'pending' -- nunca 'full_day_rate' directamente. La resolución real la
-- decide el servidor (evaluateReadinessRequest) y la escribe con
-- service-role key.
CREATE POLICY "Employees insert own readiness requests" ON readiness_requests
  FOR INSERT
  WITH CHECK (
    employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
    AND resolution = 'pending'
  );

CREATE POLICY "Employees select own readiness requests" ON readiness_requests
  FOR SELECT
  USING (employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid()));

-- "Supervisors read readiness requests" (SELECT) y "Supervisors update
-- readiness requests" (UPDATE) de la migración 049 se mantienen tal cual
-- -- no se tocan aquí.

-- ============================================================
-- payroll_readiness_credits (090_e9_readiness_payroll_credit.sql)
-- ============================================================

-- Esta es la tabla que efectivamente paga dinero (day_rate_cents). El
-- empleado ya NO puede insertar su propio crédito -- ni siquiera con el
-- trigger que fuerza el monto correcto, porque nada limitaba CUÁNTAS
-- filas podía crear. Solo el servidor (service-role, tras aplicar
-- MAX_REQUESTS_PER_QUARTER y el resto de la lógica de anti-abuso) o un
-- supervisor/admin (política "Supervisors manage readiness credits",
-- FOR ALL, ya existente en 090 y sin cambios aquí) puede crear estas
-- filas.
DROP POLICY IF EXISTS "Employees insert own readiness credit" ON payroll_readiness_credits;

-- "Employees read own readiness credit" (SELECT) se mantiene: el
-- empleado puede ver sus propios créditos ya otorgados, no crearlos.

-- Fix (auditoría de integridad de datos 2026-08-01, Agente 4): POST
-- /api/admin/empleados/[id]/offboard ejecutaba 4 pasos independientes desde
-- el route.ts sin ninguna transacción que los envolviera:
--   1. Desactivación del empleado (is_active=false, terminated_at, ...)
--   2. Pago final de Vacation Pay acumulado (employee_final_payouts)
--   3. Revocación de acceso (Supabase Auth admin API -- servicio EXTERNO)
--   4. Reasignación de servicios futuros (soltar `assignments` + tickets)
--
-- Si el paso 2 o el paso 4 fallaba a mitad de camino (ej. timeout de red
-- entre dos llamadas REST separadas), el empleado quedaba desactivado
-- (paso 1 ya committeado) SIN el resto -- ej. sin su Vacation Pay
-- registrado, o con solo la mitad de sus servicios futuros liberados a
-- dispatch-scheduler.
--
-- Fix: los pasos 1, 2 y 4 -- los tres puramente de base de datos -- se
-- mueven a una única función plpgsql (transacción atómica implícita: o
-- todos committean, o ninguno si algo lanza excepción). El paso 3 (Supabase
-- Auth admin API) es una llamada a un servicio EXTERNO y por diseño no
-- puede participar en la misma transacción SQL -- se ejecuta DESPUÉS de que
-- esta función ya committeó, exactamente como antes. Esto es intencional y
-- ya era el comportamiento correcto documentado en el route.ts original: la
-- desactivación (que bloquea dispatch/login) debe quedar aplicada aunque la
-- revocación del acceso Auth falle, nunca al revés -- así que un fallo de
-- Auth después de este RPC deja `accessRevoked: false` en la respuesta pero
-- NO revierte nada del RPC (mismo "fail-safe" que antes). Lo que este fix
-- elimina es la posibilidad de un estado intermedio INVÁLIDO entre los
-- pasos 1/2/4 (ej. desactivado pero sin Vacation Pay), no el orden general
-- del flujo.

CREATE OR REPLACE FUNCTION offboard_employee_atomic(
  p_employee_id UUID,
  p_termination_reason TEXT,
  p_effective_date DATE,
  p_admin_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee employees%ROWTYPE;
  v_calendar_year INT;
  v_ytd_row RECORD;
  v_vacation_payout_cents BIGINT := 0;
  v_assignment RECORD;
  v_reassigned_count INT := 0;
  v_affected_orders JSONB := '[]'::jsonb;
  v_in_progress_orders JSONB := '[]'::jsonb;
BEGIN
  -- Fix (auditoría de seguridad, mismo patrón que migración 300/301
  -- 2026-08-01): sin este chequeo, cualquier usuario autenticado podría
  -- invocar este RPC directo y desactivar/offboardear a CUALQUIER empleado,
  -- saltándose requireAdminRole('employees_admin') del route.ts.
  IF current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    IF NOT EXISTS (
      SELECT 1 FROM admin_roles WHERE user_id = auth.uid() AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'offboard_employee_atomic: no autorizado -- se requiere un rol administrativo activo'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_termination_reason IS NULL OR length(trim(p_termination_reason)) = 0 THEN
    RAISE EXCEPTION 'terminationReason is required';
  END IF;

  -- Lock de la fila del empleado: evita que dos offboards concurrentes del
  -- mismo empleado (doble clic) corran ambos a la vez.
  SELECT * INTO v_employee FROM employees WHERE id = p_employee_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND';
  END IF;
  IF v_employee.terminated_at IS NOT NULL THEN
    RAISE EXCEPTION 'EMPLOYEE_ALREADY_OFFBOARDED';
  END IF;

  -- --- 1. Desactivación ---
  UPDATE employees
  SET is_active = false,
      terminated_at = now(),
      termination_reason = trim(p_termination_reason),
      updated_at = now()
  WHERE id = p_employee_id;

  -- --- 2. Pago final: Vacation Pay acumulado de TODOS los años abiertos ---
  v_calendar_year := EXTRACT(YEAR FROM p_effective_date)::INT;

  FOR v_ytd_row IN
    SELECT calendar_year, ytd_vacation_pay_accrued_cents
    FROM payroll_ytd
    WHERE employee_id = p_employee_id
      AND calendar_year <= v_calendar_year
      AND ytd_vacation_pay_accrued_cents > 0
  LOOP
    v_vacation_payout_cents := v_vacation_payout_cents + v_ytd_row.ytd_vacation_pay_accrued_cents;

    INSERT INTO employee_final_payouts (employee_id, payout_type, amount_cents, payout_date, source_calendar_year, created_by)
    VALUES (p_employee_id, 'vacation_pay_accrual', v_ytd_row.ytd_vacation_pay_accrued_cents, p_effective_date, v_ytd_row.calendar_year, p_admin_id)
    ON CONFLICT (employee_id, payout_type, source_calendar_year) DO UPDATE
      SET amount_cents = EXCLUDED.amount_cents,
          payout_date = EXCLUDED.payout_date,
          created_by = EXCLUDED.created_by;
  END LOOP;

  -- --- 4. Reasignación: soltar servicios futuros no completados ---
  -- Mismo criterio que la versión anterior en TS: un servicio ya en curso
  -- (en_route/arrived/in_progress) NO se toca, se reporta aparte.
  FOR v_assignment IN
    SELECT a.id AS assignment_id, a.order_id, a.status, o.service_date
    FROM assignments a
    JOIN orders o ON o.id = a.order_id
    WHERE a.employee_id = p_employee_id
      AND a.deleted_at IS NULL
      AND o.service_date >= p_effective_date
      AND o.status NOT IN ('cancelled', 'completed')
  LOOP
    IF v_assignment.status IN ('en_route', 'arrived', 'in_progress') THEN
      v_in_progress_orders := v_in_progress_orders || jsonb_build_object(
        'orderId', v_assignment.order_id,
        'serviceDate', v_assignment.service_date,
        'status', v_assignment.status
      );

      INSERT INTO tickets_disputas (order_id, employee_id, type, priority, status, context)
      VALUES (
        v_assignment.order_id, p_employee_id, 'discrepancy', 'high', 'open',
        jsonb_build_object(
          'order_id', v_assignment.order_id,
          'reason', 'employee_offboarded_mid_service_needs_manual_handling',
          'service_date', v_assignment.service_date,
          'assignment_status', v_assignment.status,
          'source', 'offboarding'
        )
      );
    ELSE
      UPDATE assignments SET deleted_at = now() WHERE id = v_assignment.assignment_id;
      v_reassigned_count := v_reassigned_count + 1;

      v_affected_orders := v_affected_orders || jsonb_build_object(
        'orderId', v_assignment.order_id,
        'serviceDate', v_assignment.service_date
      );

      INSERT INTO tickets_disputas (order_id, employee_id, type, priority, status, context)
      VALUES (
        v_assignment.order_id, p_employee_id, 'discrepancy', 'high', 'open',
        jsonb_build_object(
          'order_id', v_assignment.order_id,
          'reason', 'employee_offboarded_needs_reassignment',
          'service_date', v_assignment.service_date,
          'source', 'offboarding'
        )
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'employeeId', p_employee_id,
    'userId', v_employee.user_id,
    'vacationPayoutCents', v_vacation_payout_cents,
    'reassignedCount', v_reassigned_count,
    'affectedOrders', v_affected_orders,
    'inProgressOrders', v_in_progress_orders
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION offboard_employee_atomic(UUID, TEXT, DATE, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION offboard_employee_atomic(UUID, TEXT, DATE, UUID) TO authenticated, service_role;

COMMENT ON FUNCTION offboard_employee_atomic IS
  'Fix integridad de datos 2026-08-01: agrupa atómicamente los pasos 1 (desactivación), 2 (pago final Vacation Pay) y 4 (liberar servicios futuros) del offboarding de un empleado, que antes eran 3+ escrituras REST sueltas desde POST /api/admin/empleados/[id]/offboard. El paso 3 (revocar acceso Auth, servicio externo) sigue fuera de esta función por diseño -- se ejecuta después, de forma no bloqueante, como ya documentaba el endpoint original. Exige un admin_roles activo para llamadas no server-side.';

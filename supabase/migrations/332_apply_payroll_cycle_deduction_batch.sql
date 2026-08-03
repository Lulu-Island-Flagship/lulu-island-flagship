-- Fix (auditoría externa 2026-07-24, §4 — DECISIONES_PENDIENTES):
-- apply_payroll_cycle_deduction (migración 246) ya agrupa cycle_deductions
-- + ytd en una sola transacción POR EMPLEADO, pero el loop en
-- payroll-export/route.ts (líneas 380-430) itera sobre N empleados
-- secuencialmente sin una transacción envolvente que los abarque a todos.
-- Si el proceso falla a mitad del loop (ej. timeout en el empleado 5 de
-- 10), los primeros 4 quedan escritos y los 6 restantes no -- sin rollback
-- posible, y el guard alreadyProcessedThisCycle (que marca como procesados
-- a los que tienen fila en cycle_deductions) impide que un reintento
-- posterior los alcance.
--
-- Fix: una función RPC que reemplace TODO el loop: recibe un array JSON con
-- los datos de todos los empleados del ciclo y los procesa en una SOLA
-- transacción de base de datos (plpgsql corre dentro de la transacción
-- implícita de la invocación). Si cualquier empleado falla, la transacción
-- entera hace rollback -- ningún empleado queda a medias.
--
-- Esta función no reemplaza a apply_payroll_cycle_deduction (246) -- ese
-- RPC de un solo empleado sigue siendo útil para otras superficies. Esta
-- es una función nueva, de batch, específica para el export de nómina.
--
-- SECURITY INVOKER (default): igual que 246, corre con los permisos RLS
-- del admin autenticado que ya pasa requireAdminRole("payroll").

CREATE OR REPLACE FUNCTION apply_payroll_cycle_deduction_batch(
  p_employees JSONB
)
RETURNS TABLE(employee_id UUID, success BOOLEAN, error_message TEXT)
LANGUAGE plpgsql
AS $$
DECLARE
  emp RECORD;
BEGIN
  FOR emp IN SELECT * FROM jsonb_to_recordset(p_employees) AS x(
    employee_id UUID,
    cycle_label TEXT,
    gross_cents INTEGER,
    cpp_cents INTEGER,
    cpp2_cents INTEGER,
    ei_employee_cents INTEGER,
    ei_employer_cents INTEGER,
    worksafebc_employer_cents INTEGER,
    vacation_pay_accrual_cents INTEGER,
    estimated_net_cents INTEGER,
    employer_cost_cents INTEGER,
    update_ytd BOOLEAN,
    calendar_year INTEGER,
    ytd_pensionable_cents INTEGER,
    ytd_insurable_cents INTEGER,
    ytd_assessable_cents INTEGER,
    ytd_cpp_contribution_cents INTEGER,
    ytd_cpp2_contribution_cents INTEGER,
    ytd_ei_employee_cents INTEGER,
    ytd_vacation_pay_accrued_cents INTEGER
  )
  LOOP
    -- Misma lógica que apply_payroll_cycle_deduction (246), repetida aquí
    -- para que todo el batch corra en una sola transacción.
    INSERT INTO payroll_cycle_deductions (
      employee_id, cycle_label, gross_cents, cpp_cents, cpp2_cents,
      ei_employee_cents, ei_employer_cents, worksafebc_employer_cents,
      vacation_pay_accrual_cents, estimated_net_cents, employer_cost_cents
    ) VALUES (
      emp.employee_id, emp.cycle_label, emp.gross_cents, emp.cpp_cents, emp.cpp2_cents,
      emp.ei_employee_cents, emp.ei_employer_cents, emp.worksafebc_employer_cents,
      emp.vacation_pay_accrual_cents, emp.estimated_net_cents, emp.employer_cost_cents
    )
    ON CONFLICT (employee_id, cycle_label) DO UPDATE SET
      gross_cents = EXCLUDED.gross_cents,
      cpp_cents = EXCLUDED.cpp_cents,
      cpp2_cents = EXCLUDED.cpp2_cents,
      ei_employee_cents = EXCLUDED.ei_employee_cents,
      ei_employer_cents = EXCLUDED.ei_employer_cents,
      worksafebc_employer_cents = EXCLUDED.worksafebc_employer_cents,
      vacation_pay_accrual_cents = EXCLUDED.vacation_pay_accrual_cents,
      estimated_net_cents = EXCLUDED.estimated_net_cents,
      employer_cost_cents = EXCLUDED.employer_cost_cents;

    IF emp.update_ytd THEN
      INSERT INTO payroll_ytd (
        employee_id, calendar_year, ytd_pensionable_cents, ytd_insurable_cents,
        ytd_assessable_cents, ytd_cpp_contribution_cents, ytd_cpp2_contribution_cents,
        ytd_ei_employee_cents, ytd_vacation_pay_accrued_cents, updated_at
      ) VALUES (
        emp.employee_id, emp.calendar_year, emp.ytd_pensionable_cents, emp.ytd_insurable_cents,
        emp.ytd_assessable_cents, emp.ytd_cpp_contribution_cents, emp.ytd_cpp2_contribution_cents,
        emp.ytd_ei_employee_cents, emp.ytd_vacation_pay_accrued_cents, now()
      )
      ON CONFLICT (employee_id, calendar_year) DO UPDATE SET
        ytd_pensionable_cents = EXCLUDED.ytd_pensionable_cents,
        ytd_insurable_cents = EXCLUDED.ytd_insurable_cents,
        ytd_assessable_cents = EXCLUDED.ytd_assessable_cents,
        ytd_cpp_contribution_cents = EXCLUDED.ytd_cpp_contribution_cents,
        ytd_cpp2_contribution_cents = EXCLUDED.ytd_cpp2_contribution_cents,
        ytd_ei_employee_cents = EXCLUDED.ytd_ei_employee_cents,
        ytd_vacation_pay_accrued_cents = EXCLUDED.ytd_vacation_pay_accrued_cents,
        updated_at = now();
    END IF;

    employee_id := emp.employee_id;
    success := true;
    error_message := null;
    RETURN NEXT;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION apply_payroll_cycle_deduction_batch IS
  'Fix (auditoría externa, atomicidad de payroll-export multi-empleado): '
  'reemplaza el loop de N empleados en payroll-export/route.ts con una sola '
  'llamada RPC que procesa todos en una transacción. Si falla a mitad del '
  'batch, la transacción entera hace rollback. Recibe un array JSON con los '
  'mismos parámetros que apply_payroll_cycle_deduction (246), pero para '
  'todos los empleados del ciclo a la vez. SECURITY INVOKER (default).';

GRANT EXECUTE ON FUNCTION apply_payroll_cycle_deduction_batch TO authenticated;

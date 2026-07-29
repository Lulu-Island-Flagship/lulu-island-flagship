-- Fix (auditoría externa, hallazgo confirmado): src/app/api/admin/
-- payroll-export/route.ts hacía, por cada empleado del ciclo, DOS upserts
-- awaited por separado y sin transacción: primero payroll_cycle_deductions,
-- después payroll_ytd (solo si el empleado no estaba ya en
-- alreadyProcessedThisCycle). Si el proceso fallaba entre esos dos pasos
-- (timeout de red, el servidor se reinicia a mitad del loop, etc.), la fila
-- de payroll_cycle_deductions para ese empleado quedaba escrita pero su
-- payroll_ytd NO se actualizaba.
--
-- El problema no es solo ese momento puntual: el guard de idempotencia
-- (alreadyProcessedThisCycle) se calcula leyendo payroll_cycle_deductions al
-- inicio del request. Un reintento posterior vería a ese empleado como "ya
-- procesado" (porque su fila en payroll_cycle_deductions SÍ existe) y
-- saltaría el UPDATE de payroll_ytd para siempre -- el YTD queda
-- permanentemente atrasado para ese empleado en ese ciclo, sin ninguna señal
-- de que algo quedó a medias. Mismo patrón de fondo que ya se resolvió antes
-- para capacity_slots (migración 242) y client_wallets (180/233): dos
-- escrituras relacionadas que deben viajar juntas o no viajar, hechas hoy
-- como dos llamadas independientes desde la aplicación.
--
-- Fix: una función RPC que hace ambos upserts (cycle_deductions + ytd
-- condicional) en una sola llamada -- transaccional por definición, ya que
-- el cuerpo de una función plpgsql corre dentro de la transacción implícita
-- de esa invocación. src/app/api/admin/payroll-export/route.ts se actualiza
-- en la misma fecha para llamar a este RPC en vez de los dos .upsert()
-- sueltos.
--
-- A diferencia de commit_capacity_slot/release_capacity_slot (242), esta
-- función NO necesita SECURITY DEFINER ni restringir a service_role: el
-- caller de payroll-export/route.ts ya es el cliente de sesión del admin
-- autenticado (requireAdminRole("payroll"), restringido a owner_admin por
-- admin-rbac.ts), y las políticas RLS "Supervisors manage cycle deductions"
-- / "Supervisors manage payroll ytd" (migración 052) ya le permiten escribir
-- en ambas tablas con ese mismo rol -- no hay necesidad de elevar
-- privilegios, solo de agrupar dos escrituras ya autorizadas en una
-- transacción.
CREATE OR REPLACE FUNCTION apply_payroll_cycle_deduction(
  p_employee_id UUID,
  p_cycle_label TEXT,
  p_gross_cents INTEGER,
  p_cpp_cents INTEGER,
  p_cpp2_cents INTEGER,
  p_ei_employee_cents INTEGER,
  p_ei_employer_cents INTEGER,
  p_worksafebc_employer_cents INTEGER,
  p_vacation_pay_accrual_cents INTEGER,
  p_estimated_net_cents INTEGER,
  p_employer_cost_cents INTEGER,
  p_update_ytd BOOLEAN,
  p_calendar_year INTEGER,
  p_ytd_pensionable_cents INTEGER,
  p_ytd_insurable_cents INTEGER,
  p_ytd_assessable_cents INTEGER,
  p_ytd_cpp_contribution_cents INTEGER,
  p_ytd_cpp2_contribution_cents INTEGER,
  p_ytd_ei_employee_cents INTEGER,
  p_ytd_vacation_pay_accrued_cents INTEGER
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO payroll_cycle_deductions (
    employee_id, cycle_label, gross_cents, cpp_cents, cpp2_cents,
    ei_employee_cents, ei_employer_cents, worksafebc_employer_cents,
    vacation_pay_accrual_cents, estimated_net_cents, employer_cost_cents
  ) VALUES (
    p_employee_id, p_cycle_label, p_gross_cents, p_cpp_cents, p_cpp2_cents,
    p_ei_employee_cents, p_ei_employer_cents, p_worksafebc_employer_cents,
    p_vacation_pay_accrual_cents, p_estimated_net_cents, p_employer_cost_cents
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

  -- p_update_ytd = false cuando este ciclo ya se había procesado antes para
  -- este empleado (mismo criterio que alreadyProcessedThisCycle en
  -- route.ts) -- el cycle_deductions de arriba sigue siendo un upsert
  -- idempotente (sobreescribe con los mismos valores), pero el YTD no debe
  -- volver a sumarse.
  IF p_update_ytd THEN
    INSERT INTO payroll_ytd (
      employee_id, calendar_year, ytd_pensionable_cents, ytd_insurable_cents,
      ytd_assessable_cents, ytd_cpp_contribution_cents, ytd_cpp2_contribution_cents,
      ytd_ei_employee_cents, ytd_vacation_pay_accrued_cents, updated_at
    ) VALUES (
      p_employee_id, p_calendar_year, p_ytd_pensionable_cents, p_ytd_insurable_cents,
      p_ytd_assessable_cents, p_ytd_cpp_contribution_cents, p_ytd_cpp2_contribution_cents,
      p_ytd_ei_employee_cents, p_ytd_vacation_pay_accrued_cents, now()
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
END;
$$;

COMMENT ON FUNCTION apply_payroll_cycle_deduction IS
  'Fix (auditoría externa, atomicidad de payroll-export): agrupa el upsert de payroll_cycle_deductions '
  'y el upsert condicional de payroll_ytd en una sola transacción, reemplazando dos .upsert() sueltos '
  'en src/app/api/admin/payroll-export/route.ts que podían quedar a medias si el proceso fallaba entre '
  'ambos. SECURITY INVOKER (default): corre con los permisos RLS del admin autenticado que la invoca.';

GRANT EXECUTE ON FUNCTION apply_payroll_cycle_deduction TO authenticated;

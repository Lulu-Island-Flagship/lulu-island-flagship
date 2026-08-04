-- Fix: M3 [MEDIUM] REVOKE EXECUTE on batch payroll function
-- apply_payroll_cycle_deduction_batch (332) was granted to authenticated
-- but should also explicitly revoke from PUBLIC and anon to prevent
-- unauthenticated access.

REVOKE EXECUTE ON FUNCTION apply_payroll_cycle_deduction_batch FROM PUBLIC, anon;

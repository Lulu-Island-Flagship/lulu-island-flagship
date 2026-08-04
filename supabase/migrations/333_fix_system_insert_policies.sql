-- Fix: R1 [CRITICAL] Remove overly permissive "System insert" policies
-- These policies used FOR INSERT WITH CHECK (true) or FOR ALL USING (true),
-- granting write access to ANY authenticated user.
-- They are replaced with is_supervisor(auth.uid()) checks.
-- For cron_execution_guard, the ALL policy is dropped entirely since
-- service_role bypasses RLS anyway.
--
-- Each block checks table existence first — some tables (like contract_instances)
-- were dropped by later migrations on production and no longer exist.

-- payroll_entries (021_modulo2_payroll.sql)
DO $$ BEGIN
  IF to_regclass('public.payroll_entries') IS NOT NULL THEN
    DROP POLICY IF EXISTS "System insert payroll" ON payroll_entries;
    CREATE POLICY "System insert payroll" ON payroll_entries
      FOR INSERT WITH CHECK (is_supervisor(auth.uid()));
  END IF;
END $$;

-- contract_instances (022_modulo2_recurring_contracts.sql)
-- NOTE: this table was later dropped as orphan (184); policy cleanup is a no-op.
DO $$ BEGIN
  IF to_regclass('public.contract_instances') IS NOT NULL THEN
    DROP POLICY IF EXISTS "System insert contract instances" ON contract_instances;
    CREATE POLICY "System insert contract instances" ON contract_instances
      FOR INSERT WITH CHECK (is_supervisor(auth.uid()));
  END IF;
END $$;

-- chargeback_reserves (024_modulo2_chargeback_reserve.sql)
DO $$ BEGIN
  IF to_regclass('public.chargeback_reserves') IS NOT NULL THEN
    DROP POLICY IF EXISTS "System insert chargeback reserves" ON chargeback_reserves;
    CREATE POLICY "System insert chargeback reserves" ON chargeback_reserves
      FOR INSERT WITH CHECK (is_supervisor(auth.uid()));
  END IF;
END $$;

-- wallet_transactions (025_modulo2_wallet.sql)
DO $$ BEGIN
  IF to_regclass('public.wallet_transactions') IS NOT NULL THEN
    DROP POLICY IF EXISTS "System insert wallet transactions" ON wallet_transactions;
    CREATE POLICY "System insert wallet transactions" ON wallet_transactions
      FOR INSERT WITH CHECK (is_supervisor(auth.uid()));
  END IF;
END $$;

-- dispatch_runs (026_modulo3_capacity_dispatch.sql)
DO $$ BEGIN
  IF to_regclass('public.dispatch_runs') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Service role insert dispatch runs" ON dispatch_runs;
    CREATE POLICY "Service role insert dispatch runs" ON dispatch_runs
      FOR INSERT WITH CHECK (is_supervisor(auth.uid()));
  END IF;
END $$;

-- cron_execution_guard (073_e2_payment_retry_escalation.sql)
-- This table had FOR ALL USING (true) WITH CHECK (true) — drop it entirely.
-- service_role bypasses RLS; if a cron job needs to insert, it should use
-- the service_role client, not rely on an open RLS policy.
DO $$ BEGIN
  IF to_regclass('public.cron_execution_guard') IS NOT NULL THEN
    DROP POLICY IF EXISTS "System manage cron guard" ON cron_execution_guard;
  END IF;
END $$;

-- payment_recovery_notifications (073_e2_payment_retry_escalation.sql)
DO $$ BEGIN
  IF to_regclass('public.payment_recovery_notifications') IS NOT NULL THEN
    DROP POLICY IF EXISTS "System insert payment recovery notifications" ON payment_recovery_notifications;
    CREATE POLICY "System insert payment recovery notifications" ON payment_recovery_notifications
      FOR INSERT WITH CHECK (is_supervisor(auth.uid()));
  END IF;
END $$;

-- cash_tax_reserve_ledger (074_e2_cash_reserve_exposure.sql)
DO $$ BEGIN
  IF to_regclass('public.cash_tax_reserve_ledger') IS NOT NULL THEN
    DROP POLICY IF EXISTS "System insert tax reserve ledger" ON cash_tax_reserve_ledger;
    CREATE POLICY "System insert tax reserve ledger" ON cash_tax_reserve_ledger
      FOR INSERT WITH CHECK (is_supervisor(auth.uid()));
  END IF;
END $$;

-- cash_exposure_alerts (074_e2_cash_reserve_exposure.sql)
DO $$ BEGIN
  IF to_regclass('public.cash_exposure_alerts') IS NOT NULL THEN
    DROP POLICY IF EXISTS "System insert cash exposure alerts" ON cash_exposure_alerts;
    CREATE POLICY "System insert cash exposure alerts" ON cash_exposure_alerts
      FOR INSERT WITH CHECK (is_supervisor(auth.uid()));
  END IF;
END $$;

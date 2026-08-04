-- Migration 334 only added SELECT/INSERT — this adds UPDATE/DELETE for
-- supervisor correction workflows. Supervisors must be able to correct records
-- (e.g. data subject request status, breach incident details) through the
-- application without a service_role workaround.
--
-- Each block checks table existence first so the migration is safe to run
-- against databases where a table might have been dropped.

-- 1. data_subject_requests
DO $$ BEGIN
  IF to_regclass('public.data_subject_requests') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Supervisors update data subject requests" ON data_subject_requests;
    CREATE POLICY "Supervisors update data subject requests" ON data_subject_requests
      FOR UPDATE USING (is_supervisor(auth.uid()))
      WITH CHECK (is_supervisor(auth.uid()));

    DROP POLICY IF EXISTS "Supervisors delete data subject requests" ON data_subject_requests;
    CREATE POLICY "Supervisors delete data subject requests" ON data_subject_requests
      FOR DELETE USING (is_supervisor(auth.uid()));
  END IF;
END $$;

-- 2. data_breach_incidents
DO $$ BEGIN
  IF to_regclass('public.data_breach_incidents') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Supervisors update data breach incidents" ON data_breach_incidents;
    CREATE POLICY "Supervisors update data breach incidents" ON data_breach_incidents
      FOR UPDATE USING (is_supervisor(auth.uid()))
      WITH CHECK (is_supervisor(auth.uid()));

    DROP POLICY IF EXISTS "Supervisors delete data breach incidents" ON data_breach_incidents;
    CREATE POLICY "Supervisors delete data breach incidents" ON data_breach_incidents
      FOR DELETE USING (is_supervisor(auth.uid()));
  END IF;
END $$;

-- 3. legal_monitoring_feeds
DO $$ BEGIN
  IF to_regclass('public.legal_monitoring_feeds') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Supervisors update legal monitoring feeds" ON legal_monitoring_feeds;
    CREATE POLICY "Supervisors update legal monitoring feeds" ON legal_monitoring_feeds
      FOR UPDATE USING (is_supervisor(auth.uid()))
      WITH CHECK (is_supervisor(auth.uid()));

    DROP POLICY IF EXISTS "Supervisors delete legal monitoring feeds" ON legal_monitoring_feeds;
    CREATE POLICY "Supervisors delete legal monitoring feeds" ON legal_monitoring_feeds
      FOR DELETE USING (is_supervisor(auth.uid()));
  END IF;
END $$;

-- 4. legal_change_alerts
DO $$ BEGIN
  IF to_regclass('public.legal_change_alerts') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Supervisors update legal change alerts" ON legal_change_alerts;
    CREATE POLICY "Supervisors update legal change alerts" ON legal_change_alerts
      FOR UPDATE USING (is_supervisor(auth.uid()))
      WITH CHECK (is_supervisor(auth.uid()));

    DROP POLICY IF EXISTS "Supervisors delete legal change alerts" ON legal_change_alerts;
    CREATE POLICY "Supervisors delete legal change alerts" ON legal_change_alerts
      FOR DELETE USING (is_supervisor(auth.uid()));
  END IF;
END $$;

-- 5. legal_monitoring_blind_alerts
DO $$ BEGIN
  IF to_regclass('public.legal_monitoring_blind_alerts') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Supervisors update legal monitoring blind alerts" ON legal_monitoring_blind_alerts;
    CREATE POLICY "Supervisors update legal monitoring blind alerts" ON legal_monitoring_blind_alerts
      FOR UPDATE USING (is_supervisor(auth.uid()))
      WITH CHECK (is_supervisor(auth.uid()));

    DROP POLICY IF EXISTS "Supervisors delete legal monitoring blind alerts" ON legal_monitoring_blind_alerts;
    CREATE POLICY "Supervisors delete legal monitoring blind alerts" ON legal_monitoring_blind_alerts
      FOR DELETE USING (is_supervisor(auth.uid()));
  END IF;
END $$;

-- 6. legal_monitoring_quarterly_reviews
DO $$ BEGIN
  IF to_regclass('public.legal_monitoring_quarterly_reviews') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Supervisors update legal monitoring quarterly reviews" ON legal_monitoring_quarterly_reviews;
    CREATE POLICY "Supervisors update legal monitoring quarterly reviews" ON legal_monitoring_quarterly_reviews
      FOR UPDATE USING (is_supervisor(auth.uid()))
      WITH CHECK (is_supervisor(auth.uid()));

    DROP POLICY IF EXISTS "Supervisors delete legal monitoring quarterly reviews" ON legal_monitoring_quarterly_reviews;
    CREATE POLICY "Supervisors delete legal monitoring quarterly reviews" ON legal_monitoring_quarterly_reviews
      FOR DELETE USING (is_supervisor(auth.uid()));
  END IF;
END $$;

-- Migration 362: Restrict legal monitoring SELECT to supervisors only
-- Auditoría 2026-08-06: legal_monitoring_feeds, legal_change_alerts,
-- legal_monitoring_blind_alerts tenían SELECT para cualquier authenticated.
-- Esto expone datos de monitoreo regulatorio interno a clientes regulares.
-- Se restringe a is_supervisor(), mismo patrón que legal_monitoring_quarterly_reviews.

BEGIN;

DROP POLICY IF EXISTS "Authenticated read legal monitoring feeds" ON legal_monitoring_feeds;
DROP POLICY IF EXISTS "Authenticated read legal change alerts" ON legal_change_alerts;
DROP POLICY IF EXISTS "Authenticated read legal monitoring blind alerts" ON legal_monitoring_blind_alerts;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'legal_monitoring_feeds'
      AND policyname = 'Supervisors read legal monitoring feeds'
  ) THEN
    CREATE POLICY "Supervisors read legal monitoring feeds"
      ON legal_monitoring_feeds FOR SELECT
      USING (is_supervisor(auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'legal_change_alerts'
      AND policyname = 'Supervisors read legal change alerts'
  ) THEN
    CREATE POLICY "Supervisors read legal change alerts"
      ON legal_change_alerts FOR SELECT
      USING (is_supervisor(auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'legal_monitoring_blind_alerts'
      AND policyname = 'Supervisors read legal monitoring blind alerts'
  ) THEN
    CREATE POLICY "Supervisors read legal monitoring blind alerts"
      ON legal_monitoring_blind_alerts FOR SELECT
      USING (is_supervisor(auth.uid()));
  END IF;
END $$;

COMMIT;

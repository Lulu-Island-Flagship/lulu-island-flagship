-- Fix: R2 [CRITICAL] Add RLS to PIPEDA-sensitive tables
-- Tables from 142_e9_pipeda_legal_monitoring.sql had RLS disabled.
-- These contain PII and legal compliance data; access must be restricted
-- to supervisors only.

-- 1. data_subject_requests — PIPEDA access/correction/deletion requests
ALTER TABLE data_subject_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Supervisors read data subject requests" ON data_subject_requests;
CREATE POLICY "Supervisors read data subject requests" ON data_subject_requests
  FOR SELECT USING (is_supervisor(auth.uid()));

DROP POLICY IF EXISTS "Supervisors insert data subject requests" ON data_subject_requests;
CREATE POLICY "Supervisors insert data subject requests" ON data_subject_requests
  FOR INSERT WITH CHECK (is_supervisor(auth.uid()));

-- 2. data_breach_incidents — breach protocol with hash-chain
ALTER TABLE data_breach_incidents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Supervisors read data breach incidents" ON data_breach_incidents;
CREATE POLICY "Supervisors read data breach incidents" ON data_breach_incidents
  FOR SELECT USING (is_supervisor(auth.uid()));

DROP POLICY IF EXISTS "Supervisors insert data breach incidents" ON data_breach_incidents;
CREATE POLICY "Supervisors insert data breach incidents" ON data_breach_incidents
  FOR INSERT WITH CHECK (is_supervisor(auth.uid()));

-- 3. legal_monitoring_feeds — regulatory entity tracking
ALTER TABLE legal_monitoring_feeds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Supervisors read legal monitoring feeds" ON legal_monitoring_feeds;
CREATE POLICY "Supervisors read legal monitoring feeds" ON legal_monitoring_feeds
  FOR SELECT USING (is_supervisor(auth.uid()));

DROP POLICY IF EXISTS "Supervisors insert legal monitoring feeds" ON legal_monitoring_feeds;
CREATE POLICY "Supervisors insert legal monitoring feeds" ON legal_monitoring_feeds
  FOR INSERT WITH CHECK (is_supervisor(auth.uid()));

-- 4. legal_change_alerts — regulatory change alerts
ALTER TABLE legal_change_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Supervisors read legal change alerts" ON legal_change_alerts;
CREATE POLICY "Supervisors read legal change alerts" ON legal_change_alerts
  FOR SELECT USING (is_supervisor(auth.uid()));

DROP POLICY IF EXISTS "Supervisors insert legal change alerts" ON legal_change_alerts;
CREATE POLICY "Supervisors insert legal change alerts" ON legal_change_alerts
  FOR INSERT WITH CHECK (is_supervisor(auth.uid()));

-- 5. legal_monitoring_blind_alerts — feed staleness alerts
ALTER TABLE legal_monitoring_blind_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Supervisors read legal monitoring blind alerts" ON legal_monitoring_blind_alerts;
CREATE POLICY "Supervisors read legal monitoring blind alerts" ON legal_monitoring_blind_alerts
  FOR SELECT USING (is_supervisor(auth.uid()));

DROP POLICY IF EXISTS "Supervisors insert legal monitoring blind alerts" ON legal_monitoring_blind_alerts;
CREATE POLICY "Supervisors insert legal monitoring blind alerts" ON legal_monitoring_blind_alerts
  FOR INSERT WITH CHECK (is_supervisor(auth.uid()));

-- 6. legal_monitoring_quarterly_reviews — quarterly manual reviews
ALTER TABLE legal_monitoring_quarterly_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Supervisors read legal monitoring quarterly reviews" ON legal_monitoring_quarterly_reviews;
CREATE POLICY "Supervisors read legal monitoring quarterly reviews" ON legal_monitoring_quarterly_reviews
  FOR SELECT USING (is_supervisor(auth.uid()));

DROP POLICY IF EXISTS "Supervisors insert legal monitoring quarterly reviews" ON legal_monitoring_quarterly_reviews;
CREATE POLICY "Supervisors insert legal monitoring quarterly reviews" ON legal_monitoring_quarterly_reviews
  FOR INSERT WITH CHECK (is_supervisor(auth.uid()));

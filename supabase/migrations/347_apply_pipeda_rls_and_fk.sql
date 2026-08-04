-- Migración 347: Aplica RLS + políticas + FK a las 6 tablas PIPEDA
-- La migración 142 original se modificó en el repo pero ya estaba marcada como aplicada en producción.
-- Este archivo aplica las adiciones como nueva migración para que db push lo ejecute.

-- Habilitar RLS en las 6 tablas
ALTER TABLE data_subject_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_breach_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_monitoring_feeds ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_change_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_monitoring_blind_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_monitoring_quarterly_reviews ENABLE ROW LEVEL SECURITY;

-- data_subject_requests: supervisors + clientes leen/propios
DROP POLICY IF EXISTS "Supervisors read data subject requests" ON data_subject_requests;
CREATE POLICY "Supervisors read data subject requests" ON data_subject_requests FOR SELECT USING (is_supervisor(auth.uid()));
DROP POLICY IF EXISTS "Supervisors insert data subject requests" ON data_subject_requests;
CREATE POLICY "Supervisors insert data subject requests" ON data_subject_requests FOR INSERT WITH CHECK (is_supervisor(auth.uid()));
DROP POLICY IF EXISTS "Supervisors update data subject requests" ON data_subject_requests;
CREATE POLICY "Supervisors update data subject requests" ON data_subject_requests FOR UPDATE USING (is_supervisor(auth.uid())) WITH CHECK (is_supervisor(auth.uid()));
DROP POLICY IF EXISTS "Clients read own data subject requests" ON data_subject_requests;
CREATE POLICY "Clients read own data subject requests" ON data_subject_requests FOR SELECT USING (client_user_id = auth.uid());
DROP POLICY IF EXISTS "Clients insert own data subject requests" ON data_subject_requests;
CREATE POLICY "Clients insert own data subject requests" ON data_subject_requests FOR INSERT WITH CHECK (client_user_id = auth.uid());

-- data_breach_incidents: solo supervisores
DROP POLICY IF EXISTS "Supervisors read data breach incidents" ON data_breach_incidents;
CREATE POLICY "Supervisors read data breach incidents" ON data_breach_incidents FOR SELECT USING (is_supervisor(auth.uid()));
DROP POLICY IF EXISTS "Supervisors insert data breach incidents" ON data_breach_incidents;
CREATE POLICY "Supervisors insert data breach incidents" ON data_breach_incidents FOR INSERT WITH CHECK (is_supervisor(auth.uid()));
DROP POLICY IF EXISTS "Supervisors update data breach incidents" ON data_breach_incidents;
CREATE POLICY "Supervisors update data breach incidents" ON data_breach_incidents FOR UPDATE USING (is_supervisor(auth.uid())) WITH CHECK (is_supervisor(auth.uid()));

-- legal_monitoring_feeds: supervisores todo, authenticated lectura
DROP POLICY IF EXISTS "Supervisors manage legal monitoring feeds" ON legal_monitoring_feeds;
CREATE POLICY "Supervisors manage legal monitoring feeds" ON legal_monitoring_feeds FOR ALL USING (is_supervisor(auth.uid())) WITH CHECK (is_supervisor(auth.uid()));
DROP POLICY IF EXISTS "Authenticated read legal monitoring feeds" ON legal_monitoring_feeds;
CREATE POLICY "Authenticated read legal monitoring feeds" ON legal_monitoring_feeds FOR SELECT USING (auth.role() = 'authenticated');

-- legal_change_alerts: supervisores todo, authenticated lectura
DROP POLICY IF EXISTS "Supervisors manage legal change alerts" ON legal_change_alerts;
CREATE POLICY "Supervisors manage legal change alerts" ON legal_change_alerts FOR ALL USING (is_supervisor(auth.uid())) WITH CHECK (is_supervisor(auth.uid()));
DROP POLICY IF EXISTS "Authenticated read legal change alerts" ON legal_change_alerts;
CREATE POLICY "Authenticated read legal change alerts" ON legal_change_alerts FOR SELECT USING (auth.role() = 'authenticated');

-- legal_monitoring_blind_alerts: supervisores todo, authenticated lectura
DROP POLICY IF EXISTS "Supervisors manage blind alerts" ON legal_monitoring_blind_alerts;
CREATE POLICY "Supervisors manage blind alerts" ON legal_monitoring_blind_alerts FOR ALL USING (is_supervisor(auth.uid())) WITH CHECK (is_supervisor(auth.uid()));
DROP POLICY IF EXISTS "Authenticated read blind alerts" ON legal_monitoring_blind_alerts;
CREATE POLICY "Authenticated read blind alerts" ON legal_monitoring_blind_alerts FOR SELECT USING (auth.role() = 'authenticated');

-- legal_monitoring_quarterly_reviews: supervisores todo
DROP POLICY IF EXISTS "Supervisors manage quarterly reviews" ON legal_monitoring_quarterly_reviews;
CREATE POLICY "Supervisors manage quarterly reviews" ON legal_monitoring_quarterly_reviews FOR ALL USING (is_supervisor(auth.uid())) WITH CHECK (is_supervisor(auth.uid()));

-- FK de data_subject_requests.client_user_id → auth.users(id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_data_subject_requests_client'
      AND table_name = 'data_subject_requests'
  ) THEN
    ALTER TABLE data_subject_requests
      ADD CONSTRAINT fk_data_subject_requests_client
      FOREIGN KEY (client_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

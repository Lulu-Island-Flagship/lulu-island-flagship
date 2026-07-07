-- Migración: Módulo 7 — Auditoría QC, Score de Confianza + Fase 8.1 (Evaluación Cliente)
-- Ejecutar en SQL Editor de Supabase

-- ============================================================
-- 1. Tabla employee_scores (score semanal histórico)
-- ============================================================
CREATE TABLE IF NOT EXISTS employee_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  week_start DATE NOT NULL, -- lunes de la semana
  total_score INTEGER NOT NULL DEFAULT 0, -- 0-100
  telemetry_score INTEGER NOT NULL DEFAULT 0, -- 0-50
  audit_score INTEGER NOT NULL DEFAULT 0, -- 0-30
  peer_score INTEGER NOT NULL DEFAULT 0, -- 0-20
  trust_level TEXT NOT NULL DEFAULT 'standard'
    CHECK (trust_level IN ('elite', 'standard', 'observation', 'suspended')),
  services_count INTEGER NOT NULL DEFAULT 0,
  disputes_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(employee_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_employee_scores_employee ON employee_scores(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_scores_week ON employee_scores(week_start);

ALTER TABLE employee_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees read own scores" ON employee_scores
  FOR SELECT USING (employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid()));

CREATE POLICY "Supervisors read all scores" ON employee_scores
  FOR SELECT USING (is_supervisor(auth.uid()));

-- ============================================================
-- 2. Tabla field_audits (evaluación auditor de campo)
-- ============================================================
CREATE TABLE IF NOT EXISTS field_audits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  auditor_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  criteria JSONB NOT NULL DEFAULT '{}', -- {puntualidad: 5, calidad: 4, actitud: 5, sop: 5}
  notes TEXT,
  photo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  appealed_at TIMESTAMPTZ,
  appeal_reason TEXT,
  appeal_resolved_at TIMESTAMPTZ,
  appeal_resolution TEXT
);

CREATE INDEX IF NOT EXISTS idx_field_audits_employee ON field_audits(employee_id);
CREATE INDEX IF NOT EXISTS idx_field_audits_order ON field_audits(order_id);
CREATE INDEX IF NOT EXISTS idx_field_audits_auditor ON field_audits(auditor_id);

ALTER TABLE field_audits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees read own audits" ON field_audits
  FOR SELECT USING (employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid()));

CREATE POLICY "Supervisors read all audits" ON field_audits
  FOR SELECT USING (is_supervisor(auth.uid()));

CREATE POLICY "Supervisors insert audits" ON field_audits
  FOR INSERT WITH CHECK (is_supervisor(auth.uid()));

CREATE POLICY "Supervisors update audits" ON field_audits
  FOR UPDATE USING (is_supervisor(auth.uid()));

-- ============================================================
-- 3. Tabla peer_votes (votación cruzada semanal)
-- ============================================================
CREATE TABLE IF NOT EXISTS peer_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voter_employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  target_employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(voter_employee_id, target_employee_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_peer_votes_voter ON peer_votes(voter_employee_id);
CREATE INDEX IF NOT EXISTS idx_peer_votes_target ON peer_votes(target_employee_id);
CREATE INDEX IF NOT EXISTS idx_peer_votes_week ON peer_votes(week_start);

ALTER TABLE peer_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees read own votes" ON peer_votes
  FOR SELECT USING (voter_employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid()));

CREATE POLICY "Supervisors read all votes" ON peer_votes
  FOR SELECT USING (is_supervisor(auth.uid()));

CREATE POLICY "Employees insert own votes" ON peer_votes
  FOR INSERT WITH CHECK (voter_employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid()));

-- ============================================================
-- 4. Tabla qc_reviews (muro de evidencia QC)
-- ============================================================
CREATE TABLE IF NOT EXISTS qc_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  reviewer_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'auto')),
  note TEXT,
  reviewed_at TIMESTAMPTZ,
  sampling_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qc_reviews_employee ON qc_reviews(employee_id);
CREATE INDEX IF NOT EXISTS idx_qc_reviews_status ON qc_reviews(status);
CREATE INDEX IF NOT EXISTS idx_qc_reviews_order ON qc_reviews(order_id);

ALTER TABLE qc_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Supervisors read all qc" ON qc_reviews
  FOR SELECT USING (is_supervisor(auth.uid()));

CREATE POLICY "Supervisors insert qc" ON qc_reviews
  FOR INSERT WITH CHECK (is_supervisor(auth.uid()));

CREATE POLICY "Supervisors update qc" ON qc_reviews
  FOR UPDATE USING (is_supervisor(auth.uid()));

-- ============================================================
-- 5. Tabla tickets_disputas (cola priorizada)
-- ============================================================
CREATE TABLE IF NOT EXISTS tickets_disputas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('dispute', 'discrepancy', 'consulta')),
  priority TEXT NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('high', 'medium', 'low')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_review', 'resolved', 'escalated')),
  context JSONB NOT NULL DEFAULT '{}',
  resolution_note TEXT,
  resolved_by UUID REFERENCES employees(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets_disputas(status);
CREATE INDEX IF NOT EXISTS idx_tickets_priority ON tickets_disputas(priority);
CREATE INDEX IF NOT EXISTS idx_tickets_employee ON tickets_disputas(employee_id);

ALTER TABLE tickets_disputas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees read own tickets" ON tickets_disputas
  FOR SELECT USING (employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid()));

CREATE POLICY "Supervisors read all tickets" ON tickets_disputas
  FOR SELECT USING (is_supervisor(auth.uid()));

CREATE POLICY "Supervisors update tickets" ON tickets_disputas
  FOR UPDATE USING (is_supervisor(auth.uid()));

CREATE POLICY "Supervisors insert tickets" ON tickets_disputas
  FOR INSERT WITH CHECK (is_supervisor(auth.uid()));

-- ============================================================
-- 6. Tabla client_reviews (Fase 8.1 — evaluación post-servicio)
-- ============================================================
CREATE TABLE IF NOT EXISTS client_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  sentiment_score DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expired_at TIMESTAMPTZ,
  UNIQUE(order_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_client_reviews_order ON client_reviews(order_id);
CREATE INDEX IF NOT EXISTS idx_client_reviews_user ON client_reviews(user_id);

ALTER TABLE client_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clients read own reviews" ON client_reviews
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Supervisors read all reviews" ON client_reviews
  FOR SELECT USING (is_supervisor(auth.uid()));

CREATE POLICY "Clients insert own reviews" ON client_reviews
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 7. Tabla sentiment_alerts (Fase 7.4 — alertas NLP simple)
-- ============================================================
CREATE TABLE IF NOT EXISTS sentiment_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_review_id UUID NOT NULL REFERENCES client_reviews(id) ON DELETE CASCADE,
  sentiment_score DOUBLE PRECISION NOT NULL,
  threshold DOUBLE PRECISION NOT NULL DEFAULT -0.5,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'acknowledged')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sentiment_alerts_status ON sentiment_alerts(status);

ALTER TABLE sentiment_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Supervisors read all alerts" ON sentiment_alerts
  FOR SELECT USING (is_supervisor(auth.uid()));

CREATE POLICY "Supervisors update alerts" ON sentiment_alerts
  FOR UPDATE USING (is_supervisor(auth.uid()));

-- ============================================================
-- 8. Función RPC: calcular score de sentimiento simple (heurística)
-- ============================================================
CREATE OR REPLACE FUNCTION calculate_sentiment(p_comment TEXT)
RETURNS DOUBLE PRECISION
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  positive_words TEXT[] := ARRAY['good','great','excellent','amazing','perfect','love','happy','satisfied','recommend','clean','professional','punctual','friendly','thorough','spotless','impressed','wonderful','fantastic','best','quality'];
  negative_words TEXT[] := ARRAY['bad','terrible','awful','horrible','hate','angry','disappointed','dirty','late','rude','unprofessional','poor','worst','broken','damaged','missed','incomplete','rough','roughly','sloppy','careless'];
  word TEXT;
  score DOUBLE PRECISION := 0;
  comment_lower TEXT;
BEGIN
  IF p_comment IS NULL OR LENGTH(TRIM(p_comment)) = 0 THEN
    RETURN 0;
  END IF;
  
  comment_lower := LOWER(p_comment);
  
  FOREACH word IN ARRAY positive_words
  LOOP
    IF comment_lower LIKE '%' || word || '%' THEN
      score := score + 0.15;
    END IF;
  END LOOP;
  
  FOREACH word IN ARRAY negative_words
  LOOP
    IF comment_lower LIKE '%' || word || '%' THEN
      score := score - 0.25;
    END IF;
  END LOOP;
  
  -- Clamp between -1 and 1
  RETURN GREATEST(-1.0, LEAST(1.0, score));
END;
$$;

-- ============================================================
-- 9. Función RPC: recalcular score semanal de un empleado
-- ============================================================
CREATE OR REPLACE FUNCTION recalculate_weekly_score(p_employee_id UUID, p_week_start DATE)
RETURNS TABLE (total_score INTEGER, trust_level TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_telemetry INTEGER := 0;
  v_audit INTEGER := 0;
  v_peer INTEGER := 0;
  v_total INTEGER := 0;
  v_trust TEXT := 'standard';
BEGIN
  -- Telemetría (50%): servicios completados sin disputa
  SELECT COALESCE(
    50 - (COUNT(*) FILTER (WHERE t.type = 'dispute') * 15)
         - (COUNT(*) FILTER (WHERE t.type = 'discrepancy') * 10)
         + (COUNT(*) FILTER (WHERE q.status = 'approved') * 5)
         + (COUNT(*) FILTER (WHERE u.id IS NOT NULL) * 2),
    0
  ) INTO v_telemetry
  FROM assignments a
  JOIN orders o ON a.order_id = o.id
  LEFT JOIN tickets_disputas t ON t.order_id = o.id AND t.status = 'resolved'
  LEFT JOIN qc_reviews q ON q.order_id = o.id AND q.status = 'approved'
  LEFT JOIN service_upsells u ON u.order_id = o.id
  WHERE a.employee_id = p_employee_id
    AND o.service_date >= p_week_start
    AND o.service_date < p_week_start + INTERVAL '7 days';
  
  v_telemetry := GREATEST(0, LEAST(50, v_telemetry));
  
  -- Auditoría (30%): promedio móvil últimas 5 evaluaciones
  SELECT COALESCE(AVG(score) * 6, 0) INTO v_audit
  FROM field_audits
  WHERE employee_id = p_employee_id
  ORDER BY created_at DESC
  LIMIT 5;
  
  v_audit := GREATEST(0, LEAST(30, v_audit));
  
  -- Peer votes (20%): promedio de votaciones de la semana
  SELECT COALESCE(AVG(rating) * 4, 0) INTO v_peer
  FROM peer_votes
  WHERE target_employee_id = p_employee_id
    AND week_start = p_week_start;
  
  v_peer := GREATEST(0, LEAST(20, v_peer));
  
  -- Total y nivel de confianza
  v_total := v_telemetry + v_audit + v_peer;
  
  v_trust := CASE
    WHEN v_total >= 90 THEN 'elite'
    WHEN v_total >= 70 THEN 'standard'
    WHEN v_total >= 50 THEN 'observation'
    ELSE 'suspended'
  END;
  
  RETURN QUERY SELECT v_total, v_trust;
END;
$$;

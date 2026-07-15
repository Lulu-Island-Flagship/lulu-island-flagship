-- Migración 156 — v8.3 E5.7: encuesta interna pre-reseña. 24h después del
-- cierre, encuesta de 30 segundos con $10 de crédito de Billetera Lulu; una
-- queja genera un ticket prioritario (SLA 4h) ANTES de que el cliente
-- publique una reseña negativa. Nunca es incentivo por reseña PÚBLICA
-- (invariante B.2.18) -- el crédito se otorga por completar la encuesta
-- interna, sin importar la respuesta.
--
-- Distinta de client_reviews (Fase 7, migración 010): esa mide TRATO del
-- equipo (1-5★, ventana 1 día, pública/interna mezclada). Esta es
-- exclusivamente interna, 24h después, con incentivo económico y
-- consecuencia de ticket -- nunca se fusiona con la garantía ni con el
-- rating de trato (mismo principio de B.2.2: no mezclar sistemas de
-- medición con propósitos distintos).

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS pre_review_survey_token UUID UNIQUE DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS pre_review_survey_sent_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS pre_review_surveys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  satisfied BOOLEAN NOT NULL,
  complaint_text TEXT,
  wallet_credit_cents INTEGER NOT NULL DEFAULT 1000, -- $10, fijo por spec
  ticket_id UUID REFERENCES tickets_disputas(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pre_review_surveys_order ON pre_review_surveys(order_id);
CREATE INDEX IF NOT EXISTS idx_pre_review_surveys_user ON pre_review_surveys(user_id);

ALTER TABLE pre_review_surveys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Clients read own pre-review surveys" ON pre_review_surveys;
CREATE POLICY "Clients read own pre-review surveys" ON pre_review_surveys
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Clients insert own pre-review surveys" ON pre_review_surveys;
CREATE POLICY "Clients insert own pre-review surveys" ON pre_review_surveys
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Supervisors read all pre-review surveys" ON pre_review_surveys;
CREATE POLICY "Supervisors read all pre-review surveys" ON pre_review_surveys
  FOR SELECT USING (is_supervisor(auth.uid()));

COMMENT ON TABLE pre_review_surveys IS
  'v8.3 E5.7: encuesta interna 24h post-servicio. wallet_credit_cents se otorga siempre al completar (no depende de la respuesta); complaint_text no vacío crea tickets_disputas de prioridad alta (SLA 4h documentado, no automatizado).';

-- Catálogo central de eventos (E6, migración 045) -- mismo patrón que
-- 'review_request'/'dispute_resolved'/'churn_survey_recurring_60d'.
INSERT INTO communication_events (event_key, description, category, priority, default_channel) VALUES
  ('pre_review_survey', 'Encuesta interna 24h post-servicio ($10 crédito, nunca reseña pública)', 'transactional', 'normal', 'sms')
ON CONFLICT (event_key) DO NOTHING;

INSERT INTO communication_templates (event_key, language, version, body) VALUES
  ('pre_review_survey', 'en', 1,
    'Hi {client_name}, quick 30-second check-in on your {service_date} service (get $10 Lulu Wallet credit for answering): {survey_link}'),
  ('pre_review_survey', 'es', 1,
    'Hola {client_name}, una pregunta rápida de 30 segundos sobre su servicio del {service_date} (reciba $10 de crédito en Lulu Wallet por responder): {survey_link}')
ON CONFLICT (event_key, language, version) DO NOTHING;

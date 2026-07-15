-- Migración 163 — v8.3 E10.13: encuesta NPS (Net Promoter Score) trimestral.
--
-- Distinta de pre_review_surveys (migración 156, boolean satisfied/no,
-- 24h post-servicio, incentivo $10) y de client_reviews (rating 1-5★ de
-- trato del equipo). NPS es "0-10, ¿qué tan probable es que nos
-- recomiende?", medido por CLIENTE (no por orden) con cadencia trimestral,
-- sin incentivo económico (el spec D.10.13 no pide uno, y mezclar
-- incentivo con NPS sesgaría el puntaje -- principio B.2.2: no mezclar
-- sistemas de medición con propósitos distintos).
--
-- Un solo registro sirve para invitación y respuesta: se crea con
-- sent_at al enviar; score/responded_at se llenan cuando el cliente
-- contesta. El cron de envío usa MAX(sent_at) por cliente para respetar
-- la cadencia trimestral (91 días), sin necesitar una tabla separada.

CREATE TABLE IF NOT EXISTS nps_surveys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  score SMALLINT CHECK (score >= 0 AND score <= 10),
  comment TEXT,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_nps_surveys_client ON nps_surveys(client_user_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_nps_surveys_token ON nps_surveys(token);

ALTER TABLE nps_surveys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clients read own nps surveys" ON nps_surveys
  FOR SELECT USING (auth.uid() = client_user_id);

CREATE POLICY "Clients respond to own nps surveys" ON nps_surveys
  FOR UPDATE USING (auth.uid() = client_user_id) WITH CHECK (auth.uid() = client_user_id);

CREATE POLICY "Supervisors read all nps surveys" ON nps_surveys
  FOR SELECT USING (is_supervisor(auth.uid()));

CREATE TRIGGER prevent_hard_delete_nps_surveys
  BEFORE DELETE ON nps_surveys
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

COMMENT ON TABLE nps_surveys IS
  'v8.3 E10.13: NPS trimestral por cliente (score 0-10). Sin incentivo económico -- separado de pre_review_surveys y client_reviews (mismo principio: no mezclar sistemas de medición).';

-- Catálogo central de eventos (E6, migración 045) -- mismo patrón que pre_review_survey.
INSERT INTO communication_events (event_key, description, category, priority, default_channel) VALUES
  ('nps_quarterly_survey', 'Encuesta NPS trimestral (0-10, sin incentivo económico)', 'transactional', 'normal', 'email')
ON CONFLICT (event_key) DO NOTHING;

INSERT INTO communication_templates (event_key, language, version, body) VALUES
  ('nps_quarterly_survey', 'en', 1,
    'Hi {client_name}, on a scale of 0-10, how likely are you to recommend Lulu Island Flagship to a friend or colleague? {survey_link}'),
  ('nps_quarterly_survey', 'es', 1,
    'Hola {client_name}, en una escala de 0 a 10, ¿qué tan probable es que recomiende Lulu Island Flagship a un amigo o colega? {survey_link}')
ON CONFLICT (event_key, language, version) DO NOTHING;

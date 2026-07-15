-- Migración 146 — v8.3 E10 (D.10.9): detección de fuga (churn). La lógica
-- pura ya existía (src/lib/churn-detection.ts, `detectChurnSignal()`, 100%
-- testeada) desde antes de esta sesión pero NADA la usaba: ningún cron la
-- ejecutaba, ninguna ruta la exponía. Esta migración crea la bitácora que
-- conecta la clasificación con una acción real de un toque.
--
-- Dos de las cuatro señales del spec son objetivamente calculables desde
-- datos existentes (días sin servicio + patrón recurrente/esporádico) y las
-- corre un cron. Las otras dos ("cancelación + mención de competidor",
-- "score de equipo cayó >70→<40") requieren juicio humano o cruce con datos
-- que hoy no están vinculados a un cliente específico de forma automática
-- (team_weekly_scores es por equipo, no por cliente) -- se registran como
-- señal MANUAL, mismo patrón que near_misses/disaster_recovery_drills
-- cuando la detección automática no es honesta.

CREATE TABLE IF NOT EXISTS churn_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  client_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  action TEXT NOT NULL CHECK (action IN (
    'survey_20', 'discount_30_percent', 'personal_intervention', 'flag_unreported_dispute'
  )),
  reason TEXT NOT NULL,

  pattern TEXT CHECK (pattern IN ('recurring', 'sporadic')),
  days_since_last_service INTEGER,

  source TEXT NOT NULL DEFAULT 'cron' CHECK (source IN ('cron', 'manual')),

  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'actioned', 'dismissed')),
  actioned_at TIMESTAMPTZ,
  actioned_by UUID REFERENCES employees(id),
  resolution_notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_churn_signals_status ON churn_signals(status);
CREATE INDEX IF NOT EXISTS idx_churn_signals_client ON churn_signals(client_user_id);

-- Un cliente no acumula señales duplicadas del cron mientras la anterior
-- siga 'pending' -- evita spamear la bandeja del admin corriendo el cron a
-- diario contra el mismo cliente inactivo.
CREATE UNIQUE INDEX IF NOT EXISTS idx_churn_signals_one_pending_per_client
  ON churn_signals(client_user_id) WHERE status = 'pending';

ALTER TABLE churn_signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Supervisors read churn signals" ON churn_signals;
CREATE POLICY "Supervisors read churn signals" ON churn_signals
  FOR SELECT USING (is_supervisor(auth.uid()));

DROP POLICY IF EXISTS "Supervisors manage churn signals" ON churn_signals;
CREATE POLICY "Supervisors manage churn signals" ON churn_signals
  FOR ALL USING (is_supervisor(auth.uid())) WITH CHECK (is_supervisor(auth.uid()));

DROP TRIGGER IF EXISTS trg_prevent_delete ON churn_signals;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON churn_signals
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

COMMENT ON TABLE churn_signals IS
  'v8.3 E10 D.10.9: bitácora de señales de fuga (detectChurnSignal en src/lib/churn-detection.ts). source=cron para las 2 reglas basadas en tiempo, source=manual para las 2 que requieren juicio humano.';

-- Eventos de comunicación para las dos acciones que sí le hablan al cliente
-- (personal_intervention y flag_unreported_dispute son ítems de trabajo para
-- el admin, no mensajes automatizados al cliente). Mismo patrón que la
-- migración 084 (dispute_resolved).
INSERT INTO communication_events (event_key, description, category, priority, default_channel) VALUES
  ('churn_survey_recurring_60d', 'Cliente recurrente sin servicio hace 60+ días: encuesta con incentivo $20', 'marketing', 'normal', 'email'),
  ('churn_discount_sporadic_90d', 'Cliente esporádico sin servicio hace 90+ días: oferta de reactivación 30% off', 'marketing', 'normal', 'email')
ON CONFLICT (event_key) DO NOTHING;

INSERT INTO communication_templates (event_key, language, version, body) VALUES
  ('churn_survey_recurring_60d', 'en', 1,
    'Hi {client_name}, we miss having you on the schedule. A quick 30-second survey (with a $20 credit for your time) helps us understand what changed: {survey_link}'),
  ('churn_survey_recurring_60d', 'es', 1,
    'Hola {client_name}, te extrañamos en el calendario. Una encuesta rápida de 30 segundos (con $20 de crédito por tu tiempo) nos ayuda a entender qué cambió: {survey_link}'),
  ('churn_survey_recurring_60d', 'zh', 1,
    '您好{client_name}，我们很想念您。花30秒完成一个小调查（可获得$20积分）帮助我们了解情况：{survey_link}'),
  ('churn_discount_sporadic_90d', 'en', 1,
    'Hi {client_name}, it has been a while — come back with 30% off your next service: {reactivation_link}'),
  ('churn_discount_sporadic_90d', 'es', 1,
    'Hola {client_name}, ha pasado un tiempo — vuelve con 30% de descuento en tu próximo servicio: {reactivation_link}'),
  ('churn_discount_sporadic_90d', 'zh', 1,
    '您好{client_name}，好久不见——下次服务享受7折优惠：{reactivation_link}')
ON CONFLICT (event_key, language, version) DO NOTHING;

-- ============================================================
-- v8.3 E10 (D.10.2): "campo obligatorio '¿Cómo nos conociste?'" +
-- atribución CAC/LTV por canal. src/lib/attribution.ts (calculateLtv,
-- calculateCac, splitAttribution, allocateBudgetByChannel) existía 100%
-- testeado desde antes de esta sesión pero sin ningún dato real que
-- consumir: ni el campo de captación en la cotización, ni una tabla de
-- gasto por canal. Se agregan ambos aquí.
-- ============================================================

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS acquisition_channel TEXT;

COMMENT ON COLUMN quotes.acquisition_channel IS
  'v8.3 E10 D.10.2: "¿Cómo nos conociste?", capturado en el paso de resumen del cotizador. Ver src/lib/acquisition-channel.ts para los valores válidos.';

-- Gasto de marketing por canal y mes. No hay integración real con
-- plataformas de anuncios (Google Ads, Meta, etc.) -- el admin lo registra
-- a mano, mismo espíritu honesto que el checklist manual de competencia
-- (E1.13). Sin esto, calculateCac() no tiene numerador real.
CREATE TABLE IF NOT EXISTS marketing_channel_spend (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel TEXT NOT NULL,
  spend_month DATE NOT NULL, -- primer día del mes
  spend_cents INTEGER NOT NULL CHECK (spend_cents >= 0),
  notes TEXT,
  recorded_by UUID REFERENCES employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT marketing_channel_spend_month_is_first_day CHECK (EXTRACT(DAY FROM spend_month) = 1),
  CONSTRAINT marketing_channel_spend_unique_channel_month UNIQUE (channel, spend_month)
);

ALTER TABLE marketing_channel_spend ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner reads marketing spend" ON marketing_channel_spend;
CREATE POLICY "Owner reads marketing spend" ON marketing_channel_spend
  FOR SELECT USING (has_admin_role(auth.uid(), ARRAY['owner_admin']));

DROP POLICY IF EXISTS "Owner manages marketing spend" ON marketing_channel_spend;
CREATE POLICY "Owner manages marketing spend" ON marketing_channel_spend
  FOR ALL USING (has_admin_role(auth.uid(), ARRAY['owner_admin']))
  WITH CHECK (has_admin_role(auth.uid(), ARRAY['owner_admin']));

DROP TRIGGER IF EXISTS trg_prevent_delete ON marketing_channel_spend;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON marketing_channel_spend
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

COMMENT ON TABLE marketing_channel_spend IS
  'v8.3 E10 D.10.2: gasto de marketing por canal/mes, registrado a mano (sin integración real con plataformas de anuncios). Alimenta calculateCac() en src/lib/attribution.ts.';

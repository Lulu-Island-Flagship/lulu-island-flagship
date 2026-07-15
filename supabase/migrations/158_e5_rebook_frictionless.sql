-- Migración 158 — v8.3 E5.12: Recompra frictionless.
-- "reagendar desde galería (3 toques), recurrente de un toque, cumpleaños
-- con regalo configurable, recordatorio de recomendación del líder."
--
-- Reagendar y recurrente NO necesitan columnas nuevas de precio: reusan
-- /api/quote (recalcula siempre en servidor) + /reserva/[quoteId] (checkout
-- ya probado). Solo se agrega trazabilidad de origen (rebooked_from_order_id)
-- y lo estrictamente necesario para el regalo de cumpleaños.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS rebooked_from_order_id UUID REFERENCES orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_rebooked_from ON orders(rebooked_from_order_id);

ALTER TABLE client_profiles
  ADD COLUMN IF NOT EXISTS birth_date DATE,
  ADD COLUMN IF NOT EXISTS last_birthday_gift_year INTEGER;

COMMENT ON COLUMN client_profiles.birth_date IS
  'v8.3 E5.12: opcional, provisto voluntariamente por el cliente (cuenta/preferencias). PIPA: nunca obligatorio, nunca usado para nada más que el regalo de cumpleaños.';
COMMENT ON COLUMN client_profiles.last_birthday_gift_year IS
  'Año calendario (Vancouver) del último regalo de cumpleaños otorgado -- evita duplicar el crédito si el cron corre más de una vez el mismo día.';

-- ============================================================
-- Configuración: monto del regalo de cumpleaños, "configurable" (plan E5.12)
-- Mismo patrón singleton editable que cash_exposure_settings /
-- chargeback_settings (migración 042/074): vía admin_update_config con
-- motivo obligatorio (B.2.10), nunca UPDATE directo.
-- ============================================================
CREATE TABLE IF NOT EXISTS loyalty_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  birthday_gift_amount_cents INTEGER NOT NULL DEFAULT 1500 CHECK (birthday_gift_amount_cents > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE loyalty_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Supervisors read loyalty settings" ON loyalty_settings;
CREATE POLICY "Supervisors read loyalty settings" ON loyalty_settings
  FOR SELECT USING (is_supervisor(auth.uid()));

DROP POLICY IF EXISTS "Supervisors manage loyalty settings" ON loyalty_settings;
CREATE POLICY "Supervisors manage loyalty settings" ON loyalty_settings
  FOR ALL USING (is_supervisor(auth.uid()));

INSERT INTO loyalty_settings (birthday_gift_amount_cents)
SELECT 1500
WHERE NOT EXISTS (SELECT 1 FROM loyalty_settings);

DROP TRIGGER IF EXISTS trg_config_snapshot ON loyalty_settings;
CREATE TRIGGER trg_config_snapshot BEFORE UPDATE ON loyalty_settings
  FOR EACH ROW EXECUTE FUNCTION snapshot_config_update();

-- Amplía la whitelist de admin_update_config (migración 042) para incluir
-- loyalty_settings. CREATE OR REPLACE, misma lógica, whitelist ampliada
-- (mismo patrón documentado en 074_e2_cash_reserve_exposure.sql).
CREATE OR REPLACE FUNCTION admin_update_config(
  p_table TEXT,
  p_id UUID,
  p_changes JSONB,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_allowed TEXT[] := ARRAY[
    'feature_flags','pricing_settings','payroll_settings',
    'chargeback_settings','hhe_settings','loyalty_settings'
  ];
  v_set_clause TEXT;
  v_result JSONB;
BEGIN
  IF NOT has_admin_role(auth.uid(), ARRAY['owner_admin']) THEN
    RAISE EXCEPTION 'Solo owner_admin puede cambiar configuración';
  END IF;
  IF NOT (p_table = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'Tabla % no está en la whitelist de configuración', p_table;
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'El motivo del cambio es obligatorio (mínimo 3 caracteres)';
  END IF;

  PERFORM set_config('app.change_reason', p_reason, true);
  PERFORM set_config('app.change_user', auth.uid()::text, true);

  SELECT string_agg(format('%I = ($1->>%L)::%s', key, key,
           (SELECT format_type(a.atttypid, a.atttypmod)
            FROM pg_attribute a
            WHERE a.attrelid = p_table::regclass AND a.attname = key)), ', ')
    INTO v_set_clause
  FROM jsonb_object_keys(p_changes) AS key;

  IF v_set_clause IS NULL THEN
    RAISE EXCEPTION 'Sin cambios';
  END IF;

  EXECUTE format('UPDATE %I SET %s WHERE id = $2 RETURNING to_jsonb(%I.*)', p_table, v_set_clause, p_table)
    INTO v_result USING p_changes, p_id;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Fila % no encontrada en %', p_id, p_table;
  END IF;

  RETURN v_result;
END;
$$;

-- ============================================================
-- Catálogo de comunicaciones: cumpleaños ('birthday_gift' ya registrado en
-- 045) y el recordatorio de recomendación del líder (nuevo).
-- ============================================================
INSERT INTO communication_templates (event_key, language, version, body) VALUES
  ('birthday_gift', 'en', 1,
    'Happy birthday, {client_name}! We added ${gift_amount} to your Lulu Wallet as our gift. Thank you for being part of Lulu Island.'),
  ('birthday_gift', 'es', 1,
    '¡Feliz cumpleaños, {client_name}! Agregamos ${gift_amount} a su Lulu Wallet como regalo. Gracias por ser parte de Lulu Island.')
ON CONFLICT (event_key, language, version) DO NOTHING;

INSERT INTO communication_events (event_key, description, category, priority, default_channel) VALUES
  ('leader_recommendation_reminder', 'Recordatorio para recomendar al líder de equipo tras un buen servicio', 'marketing', 'low', 'sms')
ON CONFLICT (event_key) DO NOTHING;

INSERT INTO communication_templates (event_key, language, version, body) VALUES
  ('leader_recommendation_reminder', 'en', 1,
    'Glad you loved your service, {client_name}! If {leader_name} made your day, tell a friend -- word of mouth means everything to our team: {referral_link}'),
  ('leader_recommendation_reminder', 'es', 1,
    '¡Nos alegra que le haya encantado el servicio, {client_name}! Si {leader_name} hizo su día, cuéntele a un amigo -- el voz a voz lo es todo para nuestro equipo: {referral_link}')
ON CONFLICT (event_key, language, version) DO NOTHING;

COMMENT ON TABLE loyalty_settings IS
  'v8.3 E5.12: monto configurable del regalo de cumpleaños (Lulu Wallet). Singleton, editable solo vía admin_update_config con motivo (B.2.10).';

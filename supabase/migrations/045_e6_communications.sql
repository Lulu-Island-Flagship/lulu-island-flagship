-- ============================================================
-- E6 — COMUNICACIONES CENTRALIZADAS (v8.3, M13)
-- Catálogo central de eventos + plantillas versionadas por idioma +
-- timeline por orden. El panel de edición (UI) queda 🎨 wireframe-first.
-- Principio: el cliente no recibe 5 mensajes de 5 sistemas.
-- ============================================================

-- 1. Catálogo de eventos de comunicación
CREATE TABLE IF NOT EXISTS communication_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('transactional', 'marketing')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('urgent', 'normal')),
  default_channel TEXT NOT NULL DEFAULT 'sms' CHECK (default_channel IN ('sms', 'email', 'whatsapp', 'call')),
  fallback_channels TEXT[] NOT NULL DEFAULT ARRAY['email'],
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- 2. Plantillas versionadas por idioma (editar = nueva versión; revertir = re-activar anterior)
CREATE TABLE IF NOT EXISTS communication_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key TEXT NOT NULL REFERENCES communication_events(event_key),
  language TEXT NOT NULL CHECK (language IN ('en', 'zh', 'es')),
  version INTEGER NOT NULL DEFAULT 1,
  subject TEXT,
  body TEXT NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (event_key, language, version)
);

-- Solo una versión vigente por evento+idioma
CREATE UNIQUE INDEX IF NOT EXISTS idx_templates_current
  ON communication_templates (event_key, language) WHERE is_current = true AND deleted_at IS NULL;

-- 3. Timeline de comunicación (por orden y por usuario — referenciada por tickets/disputas)
CREATE TABLE IF NOT EXISTS communication_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  user_id UUID NOT NULL,
  event_key TEXT NOT NULL,
  category TEXT NOT NULL,
  channel TEXT NOT NULL,
  language TEXT NOT NULL,
  body_rendered TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'postponed', 'sent', 'delivered', 'read', 'failed')),
  postponed_reason TEXT,
  scheduled_for TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comm_log_order ON communication_log(order_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comm_log_user_week ON communication_log(user_id, category, created_at);

-- Inmutabilidad y soft delete según invariantes E0
DROP TRIGGER IF EXISTS trg_prevent_delete ON communication_events;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON communication_events
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();
DROP TRIGGER IF EXISTS trg_prevent_delete ON communication_templates;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON communication_templates
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();
DROP TRIGGER IF EXISTS trg_prevent_delete ON communication_log;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON communication_log
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

-- Eventos = configuración editable → snapshot con motivo obligatorio (E0-C6)
DROP TRIGGER IF EXISTS trg_config_snapshot ON communication_events;
CREATE TRIGGER trg_config_snapshot BEFORE UPDATE ON communication_events
  FOR EACH ROW EXECUTE FUNCTION snapshot_config_update();

-- RLS
ALTER TABLE communication_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read comm events" ON communication_events
  FOR SELECT USING (has_admin_role(auth.uid(), ARRAY['owner_admin','ops_coordinator']) OR is_supervisor(auth.uid()));
CREATE POLICY "owner manages comm events" ON communication_events
  FOR UPDATE USING (has_admin_role(auth.uid(), ARRAY['owner_admin']));
CREATE POLICY "owner inserts comm events" ON communication_events
  FOR INSERT WITH CHECK (has_admin_role(auth.uid(), ARRAY['owner_admin']));

CREATE POLICY "admins read templates" ON communication_templates
  FOR SELECT USING (has_admin_role(auth.uid(), ARRAY['owner_admin','ops_coordinator']) OR is_supervisor(auth.uid()));
CREATE POLICY "owner manages templates" ON communication_templates
  FOR ALL USING (has_admin_role(auth.uid(), ARRAY['owner_admin']));

CREATE POLICY "admins read comm log" ON communication_log
  FOR SELECT USING (has_admin_role(auth.uid(), ARRAY['owner_admin','ops_coordinator']) OR is_supervisor(auth.uid()));
CREATE POLICY "clients read own comm log" ON communication_log
  FOR SELECT USING (user_id = auth.uid());

-- ------------------------------------------------------------
-- Seed del catálogo (los textos viven en plantillas; voz de marca D.8:
-- cálida, directa — "Tu equipo está en camino", no "El equipo será enviado")
-- ------------------------------------------------------------
INSERT INTO communication_events (event_key, description, category, priority, default_channel) VALUES
  ('order_confirmed',   'Reserva confirmada con fecha/ventana',                    'transactional', 'normal', 'sms'),
  ('hold_reminder',     'Recordatorio 24h antes: autorización del Hold',           'transactional', 'normal', 'sms'),
  ('team_en_route',     'Equipo en camino con ETA',                                'transactional', 'urgent', 'sms'),
  ('arrival_delayed',   'Nueva ETA por retraso >20%',                              'transactional', 'urgent', 'sms'),
  ('service_completed', 'Galería post-servicio + aviso de cobro 7PM',              'transactional', 'normal', 'sms'),
  ('payment_failed',    'Fallo de cobro con link de actualización',                'transactional', 'urgent', 'sms'),
  ('no_show_notice',    'Cliente ausente: opciones',                               'transactional', 'urgent', 'sms'),
  ('review_request',    'Solicitud de reseña (anti-gating: a TODOS los cierres)',  'transactional', 'normal', 'sms'),
  ('internal_survey',   'Encuesta interna 24h con crédito $10',                    'transactional', 'normal', 'email'),
  ('retention_trigger', 'Mantenimiento sugerido por metadata física (PIPA-safe)',  'marketing',     'normal', 'sms'),
  ('winback_day1',      'Win-back paso 1 (día 1 de la secuencia)',                 'marketing',     'normal', 'email'),
  ('birthday_gift',     'Cumpleaños con regalo configurable',                      'marketing',     'normal', 'email')
ON CONFLICT (event_key) DO NOTHING;

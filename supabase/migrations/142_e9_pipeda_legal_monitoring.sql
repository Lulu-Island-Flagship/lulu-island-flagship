-- v8.3 E9.7 / E9.9 — PIPEDA operativo + monitoreo legal dinámico
--
-- Cubre dos puntos del plan (Construir #7 y #9 de E9) que no tenían NINGÚN
-- soporte en el código (verificado: grep -rli "pipeda" src -> vacío):
--
-- A) PIPEDA operativo: derecho de acceso (exportación 48h), corrección,
--    eliminación (soft delete + retención fiscal 2 años + purge), y
--    protocolo de brecha (OIPC BC + afectados en 72h). Log de brecha con
--    hash-chain (cada fila incluye hash de la fila anterior) para cumplir
--    "logs inmutables con hash" del punto #4 de compliance, aplicado aquí
--    al caso más sensible (una brecha de datos).
--
-- B) Monitoreo legal dinámico: registro de los 7 entes regulatorios con su
--    frecuencia de chequeo declarada y el health-check de "ceguera" (feed
--    sin actualizar 30 días). Esto NO es scraping real de esos 7 sitios
--    (eso no existe hoy y sería un módulo aparte) -- es la infraestructura
--    de seguimiento + alerta que el criterio de aceptación de E9 pide
--    ("Feed legal congelado 30 días (simulado) dispara la alerta de
--    ceguera"), con `last_checked_at` actualizable manualmente por el
--    admin o por una futura integración real sin cambiar el esquema.

CREATE TABLE IF NOT EXISTS data_subject_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_user_id UUID NOT NULL,
  request_type TEXT NOT NULL CHECK (request_type IN ('access', 'correction', 'deletion')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'denied')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_at TIMESTAMPTZ NOT NULL, -- access: +48h; correction/deletion: sin plazo legal fijo, se deja igual como SLA operativo
  completed_at TIMESTAMPTZ,
  requested_by_admin UUID, -- NULL si el propio cliente lo pidió (self-service)
  processed_by_admin UUID,
  correction_details TEXT, -- qué se corrige (solo request_type = correction)
  denial_reason TEXT,
  export_reference TEXT, -- referencia externa del export generado (access)
  purge_eligible_at TIMESTAMPTZ, -- solo deletion: soft-delete ya + 2 años retención fiscal
  purged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_dsr_client ON data_subject_requests(client_user_id);
CREATE INDEX IF NOT EXISTS idx_dsr_status_due ON data_subject_requests(status, due_at);

DROP TRIGGER IF EXISTS trg_prevent_delete_dsr ON data_subject_requests;
CREATE TRIGGER trg_prevent_delete_dsr BEFORE DELETE ON data_subject_requests
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

-- Protocolo de brecha: OIPC BC + afectados notificados dentro de 72h desde
-- la detección. Hash-chain: cada fila guarda sha256(fila_anterior.hash ||
-- contenido_de_esta_fila) para que una edición retroactiva sea detectable
-- (comparando la cadena, no solo confiando en `updated_at`).
CREATE TABLE IF NOT EXISTS data_breach_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  description TEXT NOT NULL,
  affected_client_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  severity TEXT NOT NULL DEFAULT 'unknown' CHECK (severity IN ('low', 'medium', 'high', 'unknown')),
  oipc_notified_at TIMESTAMPTZ,
  affected_notified_at TIMESTAMPTZ,
  notification_due_at TIMESTAMPTZ NOT NULL, -- detected_at + 72h
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'contained', 'closed')),
  logged_by_admin UUID NOT NULL,
  prev_hash TEXT,
  row_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_breach_status_due ON data_breach_incidents(status, notification_due_at);

DROP TRIGGER IF EXISTS trg_prevent_delete_breach ON data_breach_incidents;
CREATE TRIGGER trg_prevent_delete_breach BEFORE DELETE ON data_breach_incidents
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

-- B) Monitoreo legal dinámico -- los 7 entes del plan (B.2.x / E9.7)
CREATE TABLE IF NOT EXISTS legal_monitoring_feeds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_name TEXT NOT NULL UNIQUE,
  check_frequency TEXT NOT NULL CHECK (check_frequency IN ('daily', 'weekly', 'monthly')),
  last_checked_at TIMESTAMPTZ,
  last_change_detected_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS legal_change_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_id UUID NOT NULL REFERENCES legal_monitoring_feeds(id),
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  change_description TEXT NOT NULL,
  dollar_impact_cents INTEGER,
  suggested_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  resolved_at TIMESTAMPTZ,
  resolved_by_admin UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_legal_alerts_feed ON legal_change_alerts(feed_id, resolved_at);

DROP TRIGGER IF EXISTS trg_prevent_delete_legal_alerts ON legal_change_alerts;
CREATE TRIGGER trg_prevent_delete_legal_alerts BEFORE DELETE ON legal_change_alerts
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

-- Health-check "ceguera": se registra cada vez que el cron detecta que un
-- feed lleva >30 días sin `last_checked_at` actualizado, para no repetir
-- la misma alerta cada día.
CREATE TABLE IF NOT EXISTS legal_monitoring_blind_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_id UUID NOT NULL REFERENCES legal_monitoring_feeds(id),
  raised_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_blind_alerts_feed_open ON legal_monitoring_blind_alerts(feed_id) WHERE resolved_at IS NULL;

-- Revisión manual trimestral de 1h -- fallback declarado del propio
-- monitoreo (E9.7): se agenda automáticamente, un admin la marca cumplida.
CREATE TABLE IF NOT EXISTS legal_monitoring_quarterly_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  due_date DATE NOT NULL UNIQUE,
  completed_at TIMESTAMPTZ,
  completed_by_admin UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed de los 7 entes con su frecuencia declarada en el plan (E9.7):
-- Employment Standards (diario), CRA y WorkSafeBC (semanal), BC Environment
-- / PIPEDA-OIPC / CASL / ICBC (mensual).
INSERT INTO legal_monitoring_feeds (entity_name, check_frequency) VALUES
  ('Employment Standards BC', 'daily'),
  ('CRA', 'weekly'),
  ('WorkSafeBC', 'weekly'),
  ('BC Environment', 'monthly'),
  ('PIPEDA / OIPC BC', 'monthly'),
  ('CASL', 'monthly'),
  ('ICBC', 'monthly')
ON CONFLICT (entity_name) DO NOTHING;

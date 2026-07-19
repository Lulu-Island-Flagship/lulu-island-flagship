-- Migración 191 — v8.3 E5 (auditoría 2026-07-18): plazo del ADMIN para
-- resolver una apelación, no del empleado para presentarla.
--
-- Bug real: src/app/api/empleado/appeal/route.ts usaba una ventana de 72h
-- desde field_audits.created_at para BLOQUEAR la apelación del empleado
-- (410 Gone). Pero 72h es la SLA que el negocio da al ADMIN para resolver
-- una apelación ya presentada, no un plazo de presentación del empleado.
-- Esta migración agrega la columna que faltaba para trackear esa SLA y
-- deja la infraestructura para que el cron appeal-deadline-check pueda
-- alertar cuando se acerca o vence.

ALTER TABLE field_audits
  ADD COLUMN IF NOT EXISTS appeal_deadline TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS appeal_deadline_alert_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS appeal_deadline_expired_alert_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN field_audits.appeal_deadline IS
  'v8.3 E5: fijado a appealed_at + 72h cuando el empleado presenta la apelación (/api/empleado/appeal). Es el plazo del ADMIN para resolver (appeal_resolved_at), NO un plazo de presentación del empleado. El cron appeal-deadline-check alerta a unified_alerts cuando faltan <12h o cuando ya venció sin resolver.';

CREATE INDEX IF NOT EXISTS idx_field_audits_appeal_pending
  ON field_audits(appeal_deadline)
  WHERE appealed_at IS NOT NULL AND appeal_resolved_at IS NULL;

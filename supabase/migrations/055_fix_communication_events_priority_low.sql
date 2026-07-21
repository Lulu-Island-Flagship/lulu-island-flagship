-- Fix: 158_e5_rebook_frictionless.sql:123 inserta
--   ('leader_recommendation_reminder', ..., 'marketing', 'low', 'sms')
-- en communication_events, pero el CHECK original de 045_e6_communications.sql:14
-- solo admite ('urgent', 'normal'). Cualquier `supabase db reset` sobre una
-- base limpia aborta en la migración 158 con
-- "new row for relation communication_events violates check constraint
-- communication_events_priority_check" -- el mismo patrón exacto que B-1
-- (INFORME_AUDITORIA_IMPLACABLE_2026-07-20b.md) para
-- communication_templates.language, resuelto entonces igual: ampliar el
-- dominio en una migración nueva antes del INSERT que lo necesita, en vez
-- de editar la migración ya existente.
--
-- 'low' es semánticamente correcto para este evento: es un recordatorio de
-- marketing (category='marketing') explícitamente de baja urgencia -- no
-- se está corrigiendo un typo, se está completando el dominio que 158 ya
-- asumía que existía.
ALTER TABLE communication_events
  DROP CONSTRAINT IF EXISTS communication_events_priority_check;

ALTER TABLE communication_events
  ADD CONSTRAINT communication_events_priority_check
  CHECK (priority IN ('urgent', 'normal', 'low'));

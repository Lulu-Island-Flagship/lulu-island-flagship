-- Migración 185 — v8.3 E7 fix de auditoría: `isKeyProblemEscalationDue()`
-- (src/lib/key-handling.ts) existía desde la migración 048 pero ningún cron
-- la invocaba nunca -- un "problema" de llaves reportado por un empleado
-- (method='problem') se guardaba en key_handling_log con
-- escalation_resolved_as='pending' y ahí se quedaba para siempre: nadie
-- disparaba la escalación real a la bandeja unificada a los 15 min (D.7.5).
--
-- Esta columna evita que el cron nuevo (api/cron/key-escalation-check)
-- publique la misma alerta repetidamente cada vez que corre mientras el
-- problema sigue sin resolverse -- mismo patrón que
-- purchase_orders.reminder_sent_at / stockout_alert_sent_at (migración 048).

ALTER TABLE key_handling_log
  ADD COLUMN IF NOT EXISTS escalation_notified_at TIMESTAMPTZ;

COMMENT ON COLUMN key_handling_log.escalation_notified_at IS
  'v8.3 E7: cuándo el cron key-escalation-check publicó la escalación real (bandeja unificada) para este problema. NULL = todavía no escalado o ya resuelto antes del timer.';

-- ============================================================
-- E6 — Auditoría E6 (Comunicaciones e Inclusión): hallazgo real.
-- Dueño del módulo: E6 (comunicaciones). Lee esta tabla: E2 (cron
-- batch-capture-retry, src/app/api/cron/batch-capture-retry/route.ts).
--
-- Contexto: el evento 'payment_failed' ya existía en communication_events
-- desde la migración 045 ('Fallo de cobro con link de actualización',
-- transactional/urgent/sms) pero NUNCA tuvo plantillas
-- (communication_templates). Como consecuencia, src/lib/sms.ts tenía un
-- wrapper `sendPaymentUpdateSms` con el mensaje de SMS hardcodeado en TS
-- (fuera del catálogo, sin versión es/zh, sin registro homogéneo en
-- communication_log, sin pasar por arbitrateThrottle) llamado directo desde
-- el cron de reintento de las 10PM (D.10.9). Esta migración agrega las
-- plantillas que faltaban, siguiendo exactamente el mismo patrón que
-- 084_e6_dispute_resolved_event.sql (columnas event_key, language, version,
-- body — sin subject porque el canal default de este evento es 'sms').
-- El cron pasa a llamar dispatchCommunication('payment_failed', ...) en vez
-- de sendPaymentUpdateSms (ver cambio en route.ts, mismo commit).
-- ============================================================

INSERT INTO communication_templates (event_key, language, version, body) VALUES
  ('payment_failed', 'en', 1,
    'Hi {client_name}, we could not process payment for order {order_id}. Please update your payment method: {payment_link}'),
  ('payment_failed', 'es', 1,
    'Hola {client_name}, no pudimos procesar el pago de la orden {order_id}. Actualice su método de pago: {payment_link}'),
  ('payment_failed', 'zh', 1,
    '您好{client_name}，订单{order_id}的付款未能处理。请更新您的付款方式：{payment_link}')
ON CONFLICT (event_key, language, version) DO NOTHING;

-- ============================================================
-- payment_recovery_notifications.status (migración 073) solo aceptaba
-- 'not_configured' | 'queued' | 'sent' | 'failed' porque se llenaba con el
-- resultado crudo de sendSms(). Ahora que el cron pasa por
-- dispatchCommunication (src/lib/send-communication.ts), el status puede
-- venir también como 'postponed' (arbitrateThrottle pospuso el envío) o
-- 'skipped_no_event'/'skipped_no_template' (catálogo incompleto/desactivado)
-- -- se amplía el CHECK para reflejar fielmente esos estados en vez de
-- forzarlos a encajar en los cuatro valores originales.
-- ============================================================
ALTER TABLE payment_recovery_notifications DROP CONSTRAINT IF EXISTS payment_recovery_notifications_status_check;
ALTER TABLE payment_recovery_notifications ADD CONSTRAINT payment_recovery_notifications_status_check
  CHECK (status IN ('not_configured', 'queued', 'sent', 'failed', 'postponed', 'skipped_no_event', 'skipped_no_template'));

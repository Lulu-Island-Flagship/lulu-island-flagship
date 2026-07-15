-- v8.3 — Bug crítico encontrado en auditoría de flujo cliente (2026-07-15):
-- /api/cron/contract-ipc-adjustment sube el precio del contrato recurrente
-- automáticamente cada año y guarda un "aviso" (contract_ipc_notices) y un
-- "ajuste" (contract_ipc_adjustments), pero NUNCA llamaba a
-- dispatchCommunication -- el cliente nunca recibía ni el aviso de 30 días
-- ni la notificación del aumento en sí. En un servicio recurrente con cobro
-- automático, eso es un aumento de precio sin consentimiento informado real.
--
-- Se agregan dos eventos al catálogo central de comunicaciones (mismo patrón
-- que 045_e6_communications.sql), con plantillas en/es.

INSERT INTO communication_events (event_key, description, category, priority, default_channel) VALUES
  ('contract_ipc_notice',   'Aviso de 30 días: ajuste anual de precio del contrato recurrente', 'transactional', 'normal', 'email'),
  ('contract_ipc_adjusted', 'Confirmación: el ajuste anual de precio ya se aplicó',              'transactional', 'normal', 'email')
ON CONFLICT (event_key) DO NOTHING;

INSERT INTO communication_templates (event_key, language, version, subject, body) VALUES
  ('contract_ipc_notice', 'en', 1,
    'Your Lulu Island price is adjusting in 30 days',
    'Hi {client_name}, as part of your recurring service agreement, your price will adjust by {ipc_percentage}% on {anniversary_date} (annual cost-of-living adjustment). Your new total will be ${new_total} per visit. No action is needed -- this is just a heads-up. Questions? Reply to this email anytime.'),
  ('contract_ipc_notice', 'es', 1,
    'El precio de tu servicio Lulu Island se ajustará en 30 días',
    'Hola {client_name}, como parte de tu contrato de servicio recurrente, tu precio se ajustará en {ipc_percentage}% el {anniversary_date} (ajuste anual por costo de vida). Tu nuevo total será ${new_total} por visita. No necesitas hacer nada -- es solo un aviso. ¿Preguntas? Responde este correo cuando quieras.'),
  ('contract_ipc_adjusted', 'en', 1,
    'Your Lulu Island price has been updated',
    'Hi {client_name}, as previously notified, your recurring service price has been adjusted to ${new_total} per visit, effective today. Thank you for being a long-term Lulu Island client.'),
  ('contract_ipc_adjusted', 'es', 1,
    'Tu precio de Lulu Island ha sido actualizado',
    'Hola {client_name}, como te avisamos antes, el precio de tu servicio recurrente se ajustó a ${new_total} por visita, con efecto desde hoy. Gracias por ser un cliente de largo plazo de Lulu Island.')
ON CONFLICT (event_key, language, version) DO NOTHING;

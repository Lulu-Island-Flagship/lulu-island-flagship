-- v8.3 — Bug alto encontrado en auditoría de flujo cliente (2026-07-15):
-- el evento 'no_show_notice' ya estaba registrado en el catálogo
-- (045_e6_communications.sql) pero NUNCA tuvo una plantilla -- y
-- /api/cron/no-show ni siquiera intentaba despachar el evento real (solo
-- hacía console.log). Resultado: el cliente nunca era notificado antes de
-- que se le cobrara la penalidad completa del hold por no-show.
INSERT INTO communication_templates (event_key, language, version, subject, body) VALUES
  ('no_show_notice', 'en', 1,
    NULL,
    'Hi, our team is at your service location but hasn''t been able to check in. Reply within 30 minutes to reschedule, or we''ll need to charge the no-show fee per our booking policy.'),
  ('no_show_notice', 'es', 1,
    NULL,
    'Hola, nuestro equipo está en tu domicilio pero no ha podido registrar la llegada. Responde en los próximos 30 minutos para reprogramar, o deberemos cobrar la tarifa de no-show según nuestra política de reserva.')
ON CONFLICT (event_key, language, version) DO NOTHING;

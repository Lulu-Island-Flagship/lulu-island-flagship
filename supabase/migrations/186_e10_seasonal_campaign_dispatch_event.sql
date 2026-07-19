-- ============================================================
-- E10 fix (auditoría) — la acción "dispatch" de
-- /api/admin/seasonal-campaigns solo cambiaba el status del run a
-- 'dispatched' pero nunca disparaba una comunicación real; no existía
-- ningún event_key en communication_events para las 5 campañas
-- estacionales, así que dispatchCommunication() habría devuelto
-- 'skipped_no_event' aunque se llamara. Esta migración agrega el evento
-- + plantillas (en/es/zh) genéricas con {campaign_name} como variable,
-- reutilizadas por las 5 campañas (spring_refresh, summer_prep,
-- back_to_routine, holiday_ready, post_holiday_reset).
-- ============================================================

INSERT INTO communication_events (event_key, description, category, priority, default_channel) VALUES
  ('seasonal_campaign_dispatch', 'Campaña estacional aprobada y despachada a clientes con marketing_opt_in', 'marketing', 'normal', 'email')
ON CONFLICT (event_key) DO NOTHING;

INSERT INTO communication_templates (event_key, language, version, subject, body, is_current) VALUES
  ('seasonal_campaign_dispatch', 'en', 1,
   'Lulu Island Flagship — {campaign_name}',
   'Hi {client_name}, it''s {campaign_name} season at Lulu Island. Book your next service: {booking_link}',
   true),
  ('seasonal_campaign_dispatch', 'es', 1,
   'Lulu Island Flagship — {campaign_name}',
   'Hola {client_name}, es temporada de {campaign_name} en Lulu Island. Reserva tu próximo servicio: {booking_link}',
   true),
  ('seasonal_campaign_dispatch', 'zh', 1,
   'Lulu Island Flagship — {campaign_name}',
   '{client_name} 您好，Lulu Island 的 {campaign_name} 季节到了。预订您的下一次服务：{booking_link}',
   true)
ON CONFLICT (event_key, language, version) DO NOTHING;

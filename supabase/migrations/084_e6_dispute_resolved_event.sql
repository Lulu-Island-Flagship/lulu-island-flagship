-- ============================================================
-- E6 — Sesión H: entrega real de comunicaciones (M13)
-- Dueño del módulo: E6 (comunicaciones). Lee esta tabla: E5 (tickets_disputas,
-- migración 001), src/lib/send-communication.ts.
--
-- Contexto: communication_events/communication_templates (migración 045) ya
-- existían pero ningún evento cubría el aviso al cliente cuando se resuelve
-- un ticket/disputa/reclamo de garantía (src/app/api/admin/tickets/[id]/resolve).
-- Esta migración agrega ese evento + sus plantillas, siguiendo exactamente
-- el mismo patrón que el seed de order_confirmed/service_completed/
-- review_request (supabase/seed.sql, no modificado aquí por instrucción
-- explícita de la tarea).
--
-- También agrega orders.review_qr_svg: el QR de reseña (B.2.18, E5.8) ahora
-- se genera de verdad (src/lib/review-delivery.ts, librería `qrcode`) en el
-- momento de T_out y se persiste aquí para que la UI de cierre del líder lo
-- muestre sin tener que recalcularlo en cada render.
-- ============================================================

-- 1. Evento: aviso de resolución de disputa/garantía
INSERT INTO communication_events (event_key, description, category, priority, default_channel) VALUES
  ('dispute_resolved', 'Aviso al cliente: su reclamo/disputa fue resuelto', 'transactional', 'normal', 'sms')
ON CONFLICT (event_key) DO NOTHING;

-- 2. Plantillas versionadas por idioma (mismo patrón que supabase/seed.sql
-- para los eventos existentes: version=1, is_current=true por default).
INSERT INTO communication_templates (event_key, language, version, body) VALUES
  ('dispute_resolved', 'en', 1,
    'Hi {client_name}, an update on your report for the {service_date} service: {resolution_summary}. Questions? Just reply to this message.'),
  ('dispute_resolved', 'es', 1,
    'Hola {client_name}, novedades sobre tu reporte del servicio del {service_date}: {resolution_summary}. ¿Dudas? Responde este mensaje.'),
  ('dispute_resolved', 'zh', 1,
    '您好{client_name}，关于{service_date}服务您反馈的问题有更新：{resolution_summary}。如有疑问请直接回复此消息。')
ON CONFLICT (event_key, language, version) DO NOTHING;

-- 3. QR de reseña persistido junto a la orden (SVG, no imagen binaria —
-- generado localmente con la librería `qrcode`, sin dependencia de un
-- proveedor externo de renderizado).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS review_qr_svg TEXT;

COMMENT ON COLUMN orders.review_qr_svg IS
  'v8.3 E5.8/E6 Sesión H: QR (SVG) del link de reseña, generado en T_out por '
  'src/lib/review-delivery.ts junto con el SMS. NULL si la orden quedó '
  'excluida por discrepancia crítica abierta (B.2.18) o si aún no completa T_out.';

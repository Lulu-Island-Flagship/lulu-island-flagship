-- ============================================================
-- E6.6 — Canal no tecnológico (v8.3, auditoría E0-E11 2026-07-18)
-- Dueño del módulo: E6 (comunicaciones e inclusión).
--
-- Contexto: E6.6 era el único punto real que quedó sin construir tras la
-- auditoría completa E0-E11 (ver Auditoria 8.3/v8.3_PLAN_DE_CONSTRUCCION.md,
-- sección E6, punto 6). Esta migración agrega el esquema mínimo para:
--   (a) reserva por teléfono (quotes.source) — src/app/api/admin/phone-booking
--   (b) cliente sin smartphone (client_profiles.no_smartphone_flow) — el
--       cron/servicio de cierre dispara 'no_smartphone_callback' en vez de
--       la galería de fotos, y el líder puede registrar pago alternativo
--       (service_closures.alt_payment_*) con recibo firmado.
--   (c) factura impresa opcional (client_profiles.printed_invoice_requested,
--       +$2 para B2C; B2B siempre true por defecto, ver trigger abajo).
--   (d) confirmación automática 24h antes ('appointment_confirmation_24h'),
--       vía cron nuevo (src/app/api/cron/appointment-confirmation-24h).
--
-- Ninguno de estos eventos tiene proveedor de voz/Twilio real conectado
-- todavía (mismo estado honesto que telephony-router.ts / traffic-
-- conditions-provider.ts) — default_channel='call' se registra siempre
-- como 'queued' por dispatchCommunication (canal sin adaptador real, ver
-- src/lib/send-communication.ts línea ~295). Esto es intencional: NUNCA se
-- simula que la llamada ocurrió de verdad.
-- ============================================================

-- 1. Reserva por teléfono: distinguir el origen de la cotización.
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'web'
  CHECK (source IN ('web', 'phone'));
COMMENT ON COLUMN quotes.source IS
  'v8.3 E6.6: origen de la cotización. ''phone'' = creada por un coordinador '
  'en /api/admin/phone-booking mientras hablaba con el cliente por teléfono, '
  'reusando exactamente src/lib/pricing.ts (misma función que el cotizador '
  'web). ''web'' es el valor histórico/default de todas las cotizaciones '
  'previas a esta migración.';

CREATE INDEX IF NOT EXISTS idx_quotes_source ON quotes(source);

-- 2. Cliente sin smartphone: flag de cuenta.
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS no_smartphone_flow BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN client_profiles.no_smartphone_flow IS
  'v8.3 E6.6: cliente sin smartphone / sin acceso cómodo a la PWA. Cuando es '
  'true: (1) al completar el servicio se dispara ''no_smartphone_callback'' '
  '(aviso de que se le llamará en 2h) en vez de ''service_completed'' '
  '(galería de fotos), ver src/lib/send-communication.ts; (2) el líder puede '
  'registrar el pago como e-transfer/cheque/efectivo con recibo firmado '
  '(service_closures.alt_payment_*) en la PWA en vez de depender de Stripe.';

-- 3. Factura impresa opcional (+$2 para B2C por correo; B2B siempre
-- impresa+digital sin recargo adicional, ver trigger más abajo).
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS printed_invoice_requested BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN client_profiles.printed_invoice_requested IS
  'v8.3 E6.6: preferencia persistida del cliente (o solicitada en su nombre '
  'por el coordinador en una reserva telefónica) de recibir factura impresa '
  'por correo, +$2 (ver PRINTED_INVOICE_SURCHARGE en src/lib/pricing.ts). '
  'Para account_type=''b2b''/''government'' este flag se fuerza a true SIN '
  'recargo (siempre impresa+digital) por el trigger '
  'trg_b2b_printed_invoice_default de esta misma migración.';

CREATE OR REPLACE FUNCTION enforce_b2b_printed_invoice_default()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.account_type IN ('b2b', 'government') THEN
    NEW.printed_invoice_requested := true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_b2b_printed_invoice_default ON client_profiles;
CREATE TRIGGER trg_b2b_printed_invoice_default
  BEFORE INSERT OR UPDATE ON client_profiles
  FOR EACH ROW EXECUTE FUNCTION enforce_b2b_printed_invoice_default();

-- Aplicar el default retroactivamente a cuentas B2B/Gov ya existentes.
UPDATE client_profiles SET printed_invoice_requested = true
  WHERE account_type IN ('b2b', 'government') AND printed_invoice_requested = false;

-- 4. Pago alternativo (e-transfer/cheque/efectivo) con recibo firmado en la
-- PWA del líder, para el flujo de cliente sin smartphone (o cualquier
-- cliente sin Stripe utilizable el día del servicio). No forma parte del
-- Protocolo de Cierre Externo de 5 requisitos (src/lib/closure-protocol.ts
-- no se modifica) -- es información adicional que el líder registra junto
-- al cierre, para que contabilidad (E9) sepa cómo se cobró este servicio.
ALTER TABLE service_closures ADD COLUMN IF NOT EXISTS alt_payment_method TEXT
  CHECK (alt_payment_method IN ('e_transfer', 'cheque', 'cash'));
ALTER TABLE service_closures ADD COLUMN IF NOT EXISTS alt_payment_amount NUMERIC(10,2);
ALTER TABLE service_closures ADD COLUMN IF NOT EXISTS alt_payment_signature_url TEXT;
ALTER TABLE service_closures ADD COLUMN IF NOT EXISTS alt_payment_confirmed_at TIMESTAMPTZ;

COMMENT ON COLUMN service_closures.alt_payment_signature_url IS
  'v8.3 E6.6: foto/firma del recibo en papel firmado por el cliente, subida '
  'al mismo bucket de evidencia (service-photos) que las fotos del checklist. '
  'Requerida cuando alt_payment_method no es null (ver validación en '
  'src/app/api/empleado/cierre/route.ts).';

-- 4b. Marca de envío para el cron de confirmación 24h antes (evita duplicados
-- si el cron corre más de una vez dentro de la ventana de la orden).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS confirmation_24h_sent_at TIMESTAMPTZ;
COMMENT ON COLUMN orders.confirmation_24h_sent_at IS
  'v8.3 E6.6: cuándo se disparó appointment_confirmation_24h para esta orden '
  '(src/app/api/cron/appointment-confirmation-24h). NULL = todavía no.';

-- 5. Catálogo de comunicaciones: los 2 eventos nuevos de E6.6.
INSERT INTO communication_events (event_key, description, category, priority, default_channel) VALUES
  ('no_smartphone_callback', 'Cliente sin smartphone: aviso de llamada de seguimiento en 2h en vez de galería de fotos', 'transactional', 'normal', 'call'),
  ('appointment_confirmation_24h', 'Confirmación automática 24h antes del servicio ([1=Sí][2=Reagendar][3=Cancelar])', 'transactional', 'urgent', 'call')
ON CONFLICT (event_key) DO NOTHING;

INSERT INTO communication_templates (event_key, language, version, body) VALUES
  ('no_smartphone_callback', 'en', 1,
    'Hi {client_name}, your {service_date} cleaning is done. Since your account is set up for phone support, our team will call you in about 2 hours to review everything -- no app needed.'),
  ('no_smartphone_callback', 'es', 1,
    'Hola {client_name}, tu limpieza del {service_date} está lista. Como tu cuenta está configurada para atención telefónica, nuestro equipo te llamará en unas 2 horas para revisar todo -- no necesitas ninguna app.'),
  ('no_smartphone_callback', 'zh', 1,
    '您好{client_name}，{service_date}的清洁服务已完成。由于您的账户设置为电话服务，我们的团队将在大约2小时后致电您确认一切情况——无需使用任何应用程序。'),

  ('appointment_confirmation_24h', 'en', 1,
    'Hi {client_name}, this confirms your Lulu Island cleaning on {service_date} at {service_time}. [1=Yes] [2=Reschedule] [3=Cancel]. (Automated call not yet connected -- see reply instructions from our team.)'),
  ('appointment_confirmation_24h', 'es', 1,
    'Hola {client_name}, confirmamos tu limpieza de Lulu Island el {service_date} a las {service_time}. [1=Sí] [2=Reagendar] [3=Cancelar]. (La llamada automática aún no está conectada -- sigue las instrucciones de respuesta de nuestro equipo.)'),
  ('appointment_confirmation_24h', 'zh', 1,
    '您好{client_name}，确认您在{service_date} {service_time}的Lulu Island清洁服务。[1=是][2=改期][3=取消]。（自动电话尚未接通——请按我们团队提供的回复方式操作。）')
ON CONFLICT (event_key, language, version) DO NOTHING;

-- Módulo de Cliente -- Comunicaciones. `client_communications` registra
-- cada mensaje (SMS/email) enviado a un cliente (confirmaciones de cita,
-- recordatorios, aviso de servicio completado, factura enviada, recibo de
-- pago, marketing, u otro mensaje operacional general) y su estado de
-- entrega. Complementa (no reemplaza) `client_consents` (272): los
-- consentimientos son registros LEGALES de aceptación de un texto versionado
-- (`legal_texts`); esta tabla es puramente OPERACIONAL -- no usa
-- `legal_texts` porque estos mensajes son textos cortos operacionales, no
-- textos legales versionados que requieran trazabilidad de versión/render.
--
-- Análogo conceptual a `communications` (266, flujo de contratación) para
-- candidatos, pero para clientes. Mismo ciclo de vida de envío async
-- (queued -> sent/failed) y mismo criterio de `template_key` opcional (no
-- todo mensaje viene de una plantilla con clave fija -- podría haber
-- mensajes ad-hoc redactados manualmente).
--
-- Por qué `subject` es nullable y de uso condicional: solo aplica cuando
-- channel = 'email' (un SMS no tiene asunto). No se agrega un CHECK que
-- fuerce subject NOT NULL cuando channel='email' a nivel de DB porque el
-- contenido del email puede resolverse enteramente desde `template_key` (la
-- plantilla trae su propio asunto) -- forzar el CHECK aquí rechazaría
-- inserciones legítimas que dependen de la plantilla. La validación de "o
-- subject o template_key" vive en la capa de aplicación
-- (client-communication-service.ts), donde sí se puede documentar la regla
-- con contexto de negocio.
--
-- Por qué `related_invoice_id` es opcional y ON DELETE SET NULL (no
-- CASCADE, no RESTRICT): permite trazar "esta comunicación fue sobre esta
-- factura" (ej. invoice_sent, payment_receipt) sin que sea obligatorio para
-- comunicaciones que no están ligadas a ninguna factura (appointment_*,
-- marketing, general). SET NULL en vez de CASCADE: si la factura
-- referenciada se elimina, el registro de la comunicación en sí (que ya se
-- envió y es historial real de contacto con el cliente) debe sobrevivir --
-- perder el vínculo a una factura eliminada no invalida el hecho de que el
-- mensaje fue enviado. RESTRICT se descartó porque `client_invoices` ya usa
-- RESTRICT contra `clients` (276) por ser registro fiscal; esta tabla no es
-- un registro fiscal, así que no hereda esa misma rigidez.
--
-- Por qué `client_id` es ON DELETE CASCADE (a diferencia de
-- `related_invoice_id`): el historial de comunicaciones es parte del
-- expediente del cliente, sin valor propio fuera de él -- mismo criterio
-- que `communications.candidate_id` (266) para candidatos.

CREATE TABLE IF NOT EXISTS client_communications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'email')),
  communication_type TEXT NOT NULL CHECK (
    communication_type IN (
      'appointment_confirmation',
      'appointment_reminder',
      'service_completed',
      'invoice_sent',
      'payment_receipt',
      'marketing',
      'general'
    )
  ),
  -- Plantilla operacional opcional (NO es legal_text_key -- ver nota de
  -- cabecera). Nullable: mensajes ad-hoc no vienen de una plantilla fija.
  template_key TEXT,
  -- Solo aplica cuando channel = 'email'. Ver nota de cabecera sobre por
  -- qué no hay CHECK a nivel de DB forzando su presencia.
  subject TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  sent_at TIMESTAMPTZ,
  related_invoice_id UUID REFERENCES client_invoices(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Historial de comunicaciones de un cliente ordenado por fecha -- consulta
-- principal de listClientCommunications().
CREATE INDEX IF NOT EXISTS idx_client_communications_client_id_created_at
  ON client_communications (client_id, created_at);

CREATE INDEX IF NOT EXISTS idx_client_communications_status
  ON client_communications (status);

ALTER TABLE client_communications ENABLE ROW LEVEL SECURITY;

-- Service-role-only, sin ninguna policy permisiva -- mismo patrón que el
-- resto de las tablas de este módulo (269-278).
DROP POLICY IF EXISTS "client_communications no direct access" ON client_communications;
CREATE POLICY "client_communications no direct access" ON client_communications
  FOR ALL USING (false) WITH CHECK (false);

COMMENT ON TABLE client_communications IS
  'Módulo de Cliente: historial de mensajes SMS/email operacionales '
  '(confirmaciones de cita, recordatorios, facturas enviadas, recibos de '
  'pago, marketing, general) enviados a un cliente, y su estado de '
  'entrega. Complementa (no reemplaza) client_consents (272) -- esta '
  'tabla es operacional, no legal. Acceso exclusivo vía service role.';

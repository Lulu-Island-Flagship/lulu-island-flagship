-- v0.4.1 (flujo de contratación) -- Fase 2 "Modelo de Datos Completo".
-- `communications` registra cada mensaje (SMS/email) enviado a un
-- candidato durante el flujo (ej. el envío de un access_code, 259, o
-- notificaciones de estado) y su estado de entrega.
--
-- Por qué `template_key` es nullable: no todo mensaje necesariamente se
-- genera desde una plantilla con clave fija (podría haber mensajes
-- ad-hoc redactados por HR) -- se deja opcional en vez de forzar un
-- valor sintético.
--
-- Por qué `status` tiene default 'queued' y CHECK enumerado
-- ('queued'/'sent'/'failed'): refleja el ciclo de vida real de un envío
-- async (se encola, luego el proveedor de SMS/email confirma envío o
-- falla) -- mismo criterio de estado enumerado que `candidates.status`
-- (257) y `access_codes.purpose` (259).
--
-- Por qué ON DELETE CASCADE con candidates: el historial de
-- comunicaciones es parte del expediente del candidato, sin valor propio
-- fuera de él (a diferencia de audit_logs, que es un log del sistema en
-- general, no ligado 1-a-1 a un candidato como entidad de negocio
-- propia).

CREATE TABLE IF NOT EXISTS communications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'email')),
  template_key TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_communications_candidate_id ON communications (candidate_id);
CREATE INDEX IF NOT EXISTS idx_communications_status ON communications (status);

ALTER TABLE communications ENABLE ROW LEVEL SECURITY;

-- Service-role-only: encolar/actualizar el estado de un envío lo hace un
-- servicio/worker con service role -- nunca acceso directo desde el
-- cliente.
DROP POLICY IF EXISTS "communications no direct access" ON communications;
CREATE POLICY "communications no direct access" ON communications
  FOR ALL USING (false) WITH CHECK (false);

COMMENT ON TABLE communications IS
  'v0.4.1 flujo de contratación: historial de mensajes SMS/email '
  'enviados a un candidato y su estado de entrega. Acceso exclusivo vía '
  'service role.';

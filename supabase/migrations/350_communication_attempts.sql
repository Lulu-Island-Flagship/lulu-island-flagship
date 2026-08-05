-- Capa 0: Communication Observability — El Espejo
-- Tabla de telemetría unificada para TODAS las comunicaciones del sistema.
-- No reemplaza los modelos locales de cada módulo — es un espejo de solo escritura.
-- Cada módulo inserta una fila justo antes o después de enviar un mensaje real.

CREATE TABLE IF NOT EXISTS communication_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    emitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    emitter_system VARCHAR(50) NOT NULL,
    emitter_user_id UUID,
    recipient_id VARCHAR(100),
    recipient_type VARCHAR(20),
    channel VARCHAR(20) NOT NULL,
    direction VARCHAR(10) NOT NULL DEFAULT 'outbound',
    business_object_type VARCHAR(50),
    business_object_id VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    template_id VARCHAR(100),
    content_hash VARCHAR(64),
    error_message TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices para las consultas más comunes del dashboard
CREATE INDEX idx_communication_attempts_emitted_at ON communication_attempts (emitted_at DESC);
CREATE INDEX idx_communication_attempts_emitter ON communication_attempts (emitter_system, emitted_at DESC);
CREATE INDEX idx_communication_attempts_business_object ON communication_attempts (business_object_type, business_object_id);
CREATE INDEX idx_communication_attempts_status ON communication_attempts (status, emitted_at DESC);
CREATE INDEX idx_communication_attempts_channel ON communication_attempts (channel, emitted_at DESC);

-- RLS: solo admins pueden leer esta tabla
ALTER TABLE communication_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can read communication attempts" ON communication_attempts
    FOR SELECT USING (EXISTS (
        SELECT 1 FROM admin_roles WHERE user_id = auth.uid() AND deleted_at IS NULL
    ));
CREATE POLICY "Service role can insert communication attempts" ON communication_attempts
    FOR INSERT WITH CHECK (true);

-- Capa 2: Communication Templates
CREATE TABLE IF NOT EXISTS communication_templates (
    template_id VARCHAR(100) PRIMARY KEY,
    channel VARCHAR(20) NOT NULL,
    subject TEXT,
    body TEXT NOT NULL,
    variables JSONB DEFAULT '[]',
    version INT NOT NULL DEFAULT 1,
    active BOOLEAN NOT NULL DEFAULT true,
    created_by VARCHAR(100),
    updated_by VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_templates_channel ON communication_templates (channel, active);

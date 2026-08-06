-- Capa 2: Communication Templates
-- v8.5 fix: la tabla puede existir de migraciones anteriores sin columna channel.
-- CREATE TABLE IF NOT EXISTS no agrega columnas faltantes; usamos ALTER para eso.
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

-- Si la tabla ya existía sin estas columnas, agregarlas ahora
ALTER TABLE communication_templates ADD COLUMN IF NOT EXISTS channel VARCHAR(20);
ALTER TABLE communication_templates ADD COLUMN IF NOT EXISTS subject TEXT;
ALTER TABLE communication_templates ADD COLUMN IF NOT EXISTS variables JSONB DEFAULT '[]';
ALTER TABLE communication_templates ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
ALTER TABLE communication_templates ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE communication_templates ADD COLUMN IF NOT EXISTS created_by VARCHAR(100);
ALTER TABLE communication_templates ADD COLUMN IF NOT EXISTS updated_by VARCHAR(100);
ALTER TABLE communication_templates ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE communication_templates ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_templates_channel ON communication_templates (channel, active);

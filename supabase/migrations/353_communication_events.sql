-- Capa 2: Communication Events — Lightweight internal event bus
-- v8.5 fix: tabla puede existir sin estas columnas
CREATE TABLE IF NOT EXISTS communication_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(50) NOT NULL,
    business_object_type VARCHAR(50),
    business_object_id VARCHAR(100),
    payload JSONB DEFAULT '{}',
    processed BOOLEAN NOT NULL DEFAULT false,
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE communication_events ADD COLUMN IF NOT EXISTS event_type VARCHAR(50);
ALTER TABLE communication_events ADD COLUMN IF NOT EXISTS business_object_type VARCHAR(50);
ALTER TABLE communication_events ADD COLUMN IF NOT EXISTS business_object_id VARCHAR(100);
ALTER TABLE communication_events ADD COLUMN IF NOT EXISTS payload JSONB DEFAULT '{}';
ALTER TABLE communication_events ADD COLUMN IF NOT EXISTS processed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE communication_events ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;
ALTER TABLE communication_events ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_events_type ON communication_events (event_type, processed, created_at);
CREATE INDEX IF NOT EXISTS idx_events_business_object ON communication_events (business_object_type, business_object_id);

-- Capa 2: Communication Events — Lightweight internal event bus
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
CREATE INDEX idx_events_type ON communication_events (event_type, processed, created_at);
CREATE INDEX idx_events_business_object ON communication_events (business_object_type, business_object_id);

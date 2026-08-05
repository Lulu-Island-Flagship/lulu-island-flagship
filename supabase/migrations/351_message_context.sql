-- Capa 1: Message Context — Link chat messages to business objects
CREATE TABLE IF NOT EXISTS message_context (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id VARCHAR(100) NOT NULL,
    channel VARCHAR(20) NOT NULL DEFAULT 'team_chat',
    business_object_type VARCHAR(50) NOT NULL,
    business_object_id VARCHAR(100) NOT NULL,
    linked_by_user_id UUID,
    linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(message_id, channel, business_object_type, business_object_id)
);
CREATE INDEX idx_message_context_business_object ON message_context (business_object_type, business_object_id);
CREATE INDEX idx_message_context_message ON message_context (message_id, channel);

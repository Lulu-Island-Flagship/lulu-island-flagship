-- Migración Módulo 2: idempotencia de webhooks de Stripe y QBO export_id nullable

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_event_id
  ON stripe_webhook_events(stripe_event_id);

ALTER TABLE qbo_export_lines
  ALTER COLUMN export_id DROP NOT NULL;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS paypal_refund_required BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paypal_refund_status TEXT DEFAULT 'not_required'
    CHECK (paypal_refund_status IN ('not_required', 'pending', 'completed', 'failed'));

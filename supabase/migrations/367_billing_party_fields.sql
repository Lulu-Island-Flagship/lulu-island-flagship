-- v9.1: billing information fields — Billing Party name, address, GST number,
-- and Service Recipient name. These support the v0.2 Service Agreement model where
-- the billing party may differ from the service recipient.
--
-- orders: billing fields captured at reservation time, available for invoice generation.
-- quotes: billing fields for the quote itself (useful when quote becomes a contract).

-- Orders — billing party identity
ALTER TABLE orders ADD COLUMN IF NOT EXISTS billing_party_name TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS billing_address_line1 TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS billing_address_line2 TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS billing_city TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS billing_province TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gst_number TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS service_recipient_name TEXT;

-- Quotes — same billing fields for the quote record
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS billing_party_name TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS billing_address_line1 TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS billing_address_line2 TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS billing_city TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS billing_province TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS gst_number TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS service_recipient_name TEXT;

COMMENT ON COLUMN orders.billing_party_name IS 'v9.1: legal name of the billing party for the invoice';
COMMENT ON COLUMN orders.gst_number IS 'v9.1: GST/HST number for B2B invoicing';
COMMENT ON COLUMN orders.service_recipient_name IS 'v9.1: name of service recipient if different from billing party';

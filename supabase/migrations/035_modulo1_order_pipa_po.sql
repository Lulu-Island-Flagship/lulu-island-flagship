-- Migración Módulo 1: propagar flags PIPA alternativa y PO a la orden

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS pipa_alt_requires_audit BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS purchase_order TEXT;

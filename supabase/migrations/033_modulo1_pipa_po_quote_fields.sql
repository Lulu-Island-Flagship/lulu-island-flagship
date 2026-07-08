-- Migración Módulo 1: alternativa PIPA sin fotos + PO obligatorio B2B

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS pipa_alt_requires_audit BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS purchase_order TEXT;

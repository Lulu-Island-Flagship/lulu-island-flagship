-- Migración Módulo 1: workflow de aprobación para cotizaciones bajo piso de margen preventivo.

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS admin_review_approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS admin_review_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS admin_review_rejected_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS admin_review_rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS admin_review_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_quotes_admin_review_required
  ON quotes(admin_review_required)
  WHERE admin_review_required = true;

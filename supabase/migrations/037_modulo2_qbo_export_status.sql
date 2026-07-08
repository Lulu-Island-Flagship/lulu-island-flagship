-- Migración Módulo 2: tracking de exportación QBO por orden

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS qbo_export_status TEXT DEFAULT 'pending'
    CHECK (qbo_export_status IN ('pending', 'exported', 'failed'));

CREATE INDEX IF NOT EXISTS idx_orders_qbo_export_status
  ON orders(qbo_export_status)
  WHERE qbo_export_status = 'pending';

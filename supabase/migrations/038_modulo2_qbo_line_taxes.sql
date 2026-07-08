-- Migración Módulo 2: añadir desglose de impuestos a líneas QBO y tipo sales_receipt

ALTER TABLE qbo_export_lines
  ADD COLUMN IF NOT EXISTS gst_amount INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pst_amount INTEGER NOT NULL DEFAULT 0;

ALTER TABLE qbo_export_lines
  DROP CONSTRAINT IF EXISTS qbo_export_lines_transaction_type_check;

ALTER TABLE qbo_export_lines
  ADD CONSTRAINT qbo_export_lines_transaction_type_check
    CHECK (transaction_type IN ('capture', 'refund', 'chargeback', 'fee', 'sales_receipt'));

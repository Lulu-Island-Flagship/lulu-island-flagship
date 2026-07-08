-- Migración Módulo 2 — Conciliación determinista con QuickBooks Online

-- ============================================================
-- 1. Tabla de exportaciones QBO
-- ============================================================
CREATE TABLE IF NOT EXISTS qbo_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  export_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'exported', 'reconciled', 'failed')),
  file_url TEXT,
  total_transactions INTEGER NOT NULL DEFAULT 0,
  total_gross INTEGER NOT NULL DEFAULT 0,
  total_fees INTEGER NOT NULL DEFAULT 0,
  total_net INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qbo_exports_date ON qbo_exports(export_date);
CREATE INDEX IF NOT EXISTS idx_qbo_exports_status ON qbo_exports(status);

ALTER TABLE qbo_exports ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Supervisors read qbo exports" ON qbo_exports
  FOR SELECT USING (is_supervisor(auth.uid()));

CREATE POLICY IF NOT EXISTS "Supervisors manage qbo exports" ON qbo_exports
  FOR ALL USING (is_supervisor(auth.uid()));

-- ============================================================
-- 2. Tabla de líneas de transacción QBO (determinista)
-- ============================================================
CREATE TABLE IF NOT EXISTS qbo_export_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  export_id UUID NOT NULL REFERENCES qbo_exports(id) ON DELETE CASCADE,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  payment_intent_id TEXT,
  transaction_type TEXT NOT NULL
    CHECK (transaction_type IN ('capture', 'refund', 'chargeback', 'fee')),
  transaction_date TIMESTAMPTZ NOT NULL,
  gross_amount INTEGER NOT NULL, -- cents CAD
  fee_amount INTEGER NOT NULL DEFAULT 0, -- Stripe fees en cents
  net_amount INTEGER NOT NULL, -- gross - fee
  description TEXT,
  qbo_reference TEXT, -- número de transacción asignado por QBO
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qbo_export_lines_export ON qbo_export_lines(export_id);
CREATE INDEX IF NOT EXISTS idx_qbo_export_lines_order ON qbo_export_lines(order_id);
CREATE INDEX IF NOT EXISTS idx_qbo_export_lines_pi ON qbo_export_lines(payment_intent_id);

ALTER TABLE qbo_export_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Supervisors read qbo export lines" ON qbo_export_lines
  FOR SELECT USING (is_supervisor(auth.uid()));

-- ============================================================
-- 3. Feature flag
-- ============================================================
INSERT INTO feature_flags (nombre, activo, modulo, descripcion)
VALUES ('qbo_export_enabled', false, 'Módulo 2', 'Exportación determinista a QuickBooks Online')
ON CONFLICT (nombre) DO UPDATE SET activo = false;

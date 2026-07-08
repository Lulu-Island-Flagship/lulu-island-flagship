-- Migración crítica: Hold T-72h, coordenadas para geocerca, y soporte de dispatch
-- Cierra hallazgos de auditoría sobre dinero, despacho y geocerca.

-- ============================================================
-- 1. Extender cotizaciones con coordenadas de la dirección
-- ============================================================
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS address_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS address_lng DOUBLE PRECISION;

-- ============================================================
-- 2. Extender órdenes con coordenadas y tracking del Hold
-- ============================================================
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS address_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS address_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS stripe_hold_payment_intent_id TEXT,
  ADD COLUMN IF NOT EXISTS hold_authorized_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hold_authorized_amount INTEGER NOT NULL DEFAULT 0;

-- ============================================================
-- 3. Índices para el job de captura batch 7:00 PM
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_orders_service_date ON orders(service_date);
CREATE INDEX IF NOT EXISTS idx_orders_hold_status
  ON orders(hold_authorized_at, hold_captured_at)
  WHERE hold_authorized_at IS NOT NULL AND hold_captured_at IS NULL;

-- ============================================================
-- 4. Política RLS para supervisores gestionando assignments
-- ============================================================
DROP POLICY IF EXISTS "Supervisors manage assignments" ON assignments;
CREATE POLICY "Supervisors manage assignments" ON assignments
  FOR ALL USING (is_supervisor(auth.uid()))
  WITH CHECK (is_supervisor(auth.uid()));

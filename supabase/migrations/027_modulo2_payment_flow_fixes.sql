-- Migración crítica Módulo 2 — Flujo de pagos correcto: Hold T-72h + Capture 7PM del total.
-- Cierra hallazgos de auditoría: hold inmediato, captura parcial, cron sin programar,
-- falta de trazabilidad de cobro total y reserva de chargebacks.

-- ============================================================
-- 1. Extender órdenes con trazabilidad completa del cobro
-- ============================================================
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS stripe_capture_payment_intent_id TEXT,
  ADD COLUMN IF NOT EXISTS capture_authorized_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS capture_captured_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS capture_authorized_amount INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hold_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS capture_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hold_last_error TEXT,
  ADD COLUMN IF NOT EXISTS capture_last_error TEXT;

-- ============================================================
-- 2. Índices para los nuevos cron jobs (T-72h hold y 7PM capture)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_orders_hold_pending
  ON orders(service_date)
  WHERE payment_option = 'card'
    AND stripe_hold_payment_intent_id IS NULL
    AND status NOT IN ('cancelled', 'no_show');

CREATE INDEX IF NOT EXISTS idx_orders_capture_pending
  ON orders(service_date)
  WHERE payment_option = 'card'
    AND stripe_capture_payment_intent_id IS NULL
    AND stripe_hold_payment_intent_id IS NOT NULL
    AND hold_captured_at IS NULL
    AND status NOT IN ('cancelled', 'no_show');

-- ============================================================
-- 3. Vista determinista de órdenes con totales para cron jobs
-- ============================================================
CREATE OR REPLACE VIEW order_payment_summary AS
SELECT
  o.id,
  o.user_id,
  o.quote_id,
  o.service_date,
  o.service_datetime,
  o.status,
  o.payment_option,
  o.hold_amount,
  o.hold_authorized_amount,
  o.stripe_hold_payment_intent_id,
  o.stripe_capture_payment_intent_id,
  o.capture_authorized_amount,
  o.stripe_customer_id,
  o.stripe_payment_method_id,
  q.total AS quote_total,
  GREATEST(0, ROUND(q.total)::INTEGER - COALESCE(o.hold_amount, 0)) AS remaining_amount
FROM orders o
JOIN quotes q ON q.id = o.quote_id;

-- ============================================================
-- 4. Función RPC para incrementar services_count de forma atómica
-- ============================================================
CREATE OR REPLACE FUNCTION increment_client_services_count(target_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE client_profiles
  SET services_count = services_count + 1,
      updated_at = now()
  WHERE user_id = target_user_id;
END;
$$;

-- ============================================================
-- 5. Feature flags: activar flujo de pagos corregido
-- ============================================================
INSERT INTO feature_flags (nombre, activo, modulo, descripcion)
VALUES ('modulo2_payment_flow_v2', true, 'Módulo 2', 'Hold T-72h + Batch Capture 7PM del total')
ON CONFLICT (nombre) DO UPDATE SET activo = true;

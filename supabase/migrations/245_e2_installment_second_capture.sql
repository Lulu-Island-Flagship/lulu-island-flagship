-- Migración 245 — cierra la limitación conocida y documentada en migración
-- 152 (v8.3 E2.10): el pago fraccionado 50/50 calculaba elegibilidad y
-- desglose, pero el cobro real de la segunda mitad (installment_second_*)
-- nunca estaba conectado a ningún cron. Ver src/lib/installment-payment.ts
-- para el comentario original de la limitación.
--
-- Mismo patrón que 137 (capture-remainder): columnas de tracking del
-- cobro + feature flag apagado por defecto (dry-run), para que el dueño
-- decida cuándo autorizar el cobro real. Nunca se cambia comportamiento
-- de dinero sin flag explícito.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS installment_second_captured_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS installment_second_payment_intent_id TEXT,
  ADD COLUMN IF NOT EXISTS installment_second_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS installment_second_last_error TEXT;

COMMENT ON COLUMN orders.installment_second_captured_at IS
  'Cuándo se cobró de verdad la segunda mitad del plan de pago fraccionado (cron installment-second-capture). NULL mientras esté pendiente o si la orden nunca usó installment_plan_selected.';
COMMENT ON COLUMN orders.installment_second_payment_intent_id IS
  'PaymentIntent de Stripe del cobro de la segunda mitad. NULL hasta que se capture.';
COMMENT ON COLUMN orders.installment_second_attempts IS
  'Reintentos fallidos del cobro de la segunda mitad. El cron detiene reintentos tras el máximo (ver MAX_INSTALLMENT_SECOND_ATTEMPTS en el código).';

CREATE INDEX IF NOT EXISTS idx_orders_installment_second_due
  ON orders(installment_second_due_at)
  WHERE installment_plan_selected = true AND installment_second_captured_at IS NULL;

-- Flag separado del que activa la elegibilidad/UI (esa parte ya vive desde
-- la 152 sin flag, es solo metadata). Este flag autoriza específicamente
-- al cron a mover dinero de verdad — apagado = dry-run (cuenta candidatos,
-- no cobra). Mismo patrón que capture_remainder_cron_enabled (137).
INSERT INTO feature_flags (nombre, activo, modulo, descripcion)
VALUES (
  'installment_second_capture_cron_enabled',
  false,
  'E2',
  'Autoriza a /api/cron/installment-second-capture a cobrar de verdad la segunda mitad de órdenes con pago fraccionado 50/50 vencidas. Apagado = dry-run (cuenta candidatos, no cobra). Ver limitación documentada en migración 152 / src/lib/installment-payment.ts.'
)
ON CONFLICT (nombre) DO UPDATE SET activo = false;

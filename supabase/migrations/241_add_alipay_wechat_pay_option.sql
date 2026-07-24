-- Feature (2026-07-21): soporte de Alipay y WeChat Pay como método de pago
-- del checkout, para clientes que prefieren estos medios (mercado chino).
--
-- Decisión de negocio (confirmada con el dueño en esta sesión): a diferencia
-- de tarjeta/Apple Pay (que soportan cobro off_session semanas después vía
-- SetupIntent) y a diferencia de PayPal first-time (que solo cobra un
-- anticipo del 50% del hold), Alipay y WeChat Pay cobran el 100% del total
-- de la orden de una sola vez, en el momento de reservar, vía un
-- PaymentIntent real de Stripe (redirect para Alipay, QR para WeChat Pay).
-- El cliente igual registra una tarjeta de respaldo (mismo requisito que
-- todas las demás opciones) SOLO para cubrir cargos extra reales que puedan
-- surgir después (daño, tiempo adicional, penalidad de cancelación tardía) —
-- nunca se le vuelve a cobrar por Alipay/WeChat Pay.
--
-- Como el pago ya es 100% por adelantado, esta orden nunca pasa por
-- hold-authorize/hold-preauth-check (ambos filtran .eq("payment_option",
-- "card"), así que quedan excluidas automáticamente sin cambios). Si el
-- cliente cancela antes del servicio, el reembolso se hace directo contra
-- el PaymentIntent de Alipay/WeChat Pay vía la API de reembolsos de Stripe
-- (síncrono, a diferencia del reembolso manual/asíncrono de PayPal).

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_payment_option_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_payment_option_check
    CHECK (payment_option IN ('card', 'paypal_first_time', 'alipay', 'wechat_pay'));

-- Fix (2026-07-24): esta migración decía "recurring_contracts", tabla que
-- nunca existió -- ese es solo el nombre del feature flag
-- ('recurring_contracts_enabled', migración 022). La tabla real, creada en
-- 022_modulo2_recurring_contracts.sql y tocada después en 039/075/225, se
-- llama service_contracts. Con el nombre viejo, `supabase db reset`/`start`
-- fallaba en seco: "relation \"recurring_contracts\" does not exist"
-- (42P01), imposible de correr limpio desde cero.
ALTER TABLE service_contracts
  DROP CONSTRAINT IF EXISTS service_contracts_payment_option_check;

ALTER TABLE service_contracts
  ADD CONSTRAINT service_contracts_payment_option_check
    CHECK (payment_option IN ('card', 'paypal_first_time', 'alipay', 'wechat_pay'));

-- Trazabilidad del PaymentIntent que cobró el 100% por adelantado (Alipay o
-- WeChat Pay) y cuánto cobró realmente, análogo a stripe_hold_payment_intent_id
-- / paypal_advance_amount para las otras opciones.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS wallet_payment_intent_id TEXT,
  ADD COLUMN IF NOT EXISTS wallet_amount_collected_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wallet_refunded_amount_cents INTEGER NOT NULL DEFAULT 0;

-- Evita que el mismo PaymentIntent de Alipay/WeChat Pay se reutilice para
-- más de una orden (mismo patrón anti-reuso que paypal_transaction_id en
-- 001_modulo1_base_schema.sql).
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_wallet_payment_intent_unique
  ON orders(wallet_payment_intent_id)
  WHERE wallet_payment_intent_id IS NOT NULL;

COMMENT ON COLUMN orders.wallet_payment_intent_id IS
  'Stripe PaymentIntent id para pago completo por adelantado vía Alipay/WeChat Pay (payment_option alipay|wechat_pay). NULL para card/paypal_first_time.';
COMMENT ON COLUMN orders.wallet_amount_collected_cents IS
  'Monto real cobrado (en centavos) por el PaymentIntent de Alipay/WeChat Pay, verificado contra Stripe en /api/stripe/confirm. 0 para card/paypal_first_time.';
COMMENT ON COLUMN orders.wallet_refunded_amount_cents IS
  'Suma de reembolsos ya emitidos contra wallet_payment_intent_id (cancelación >72h con reembolso total, o parcial en ventana 24-72h).';

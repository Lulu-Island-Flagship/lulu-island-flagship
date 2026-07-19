-- Migración 188 — v8.3 E2 (Viaje del Dinero), bug MEDIO de auditoría:
-- no existía ninguna pre-autorización silenciosa 2h antes del Batch
-- Capture (7PM Vancouver). El hold de tarjeta se crea en T-72h
-- (/api/cron/hold-authorize) y nunca se revalida hasta el momento mismo
-- de capturar (/api/cron/batch-capture) -- si el hold expiró, el banco lo
-- canceló o la tarjeta fue rechazada en el ínterin, el primer punto donde
-- se descubre es la noche del servicio, ya sin margen operativo.
--
-- Esta migración agrega el estado que necesita el nuevo cron
-- /api/cron/hold-preauth-check (corre a las 17:00 Vancouver, 2h antes del
-- Batch Capture) para revalidar el PaymentIntent con Stripe y, si ya no
-- está en 'requires_capture', reintentar un nuevo hold silenciosamente
-- antes de rendirse y escalar a ops.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS hold_reauth_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hold_reauth_last_error TEXT,
  ADD COLUMN IF NOT EXISTS hold_preauth_checked_at TIMESTAMPTZ;

COMMENT ON COLUMN orders.hold_preauth_checked_at IS
  'v8.3 E2: última vez que /api/cron/hold-preauth-check (17:00 Vancouver, T-2h del Batch Capture) revalidó el PaymentIntent de hold contra Stripe.';

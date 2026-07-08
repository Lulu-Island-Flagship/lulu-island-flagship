-- Migración Módulo 2: tracking explícito del anticipo PayPal para primer servicio.
-- El spec v8.2 define el anticipo como el 50% del Hold; lo guardamos explícito
-- para evitar recomputar y facilitar conciliación contable.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS paypal_advance_amount INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_orders_paypal_advance
  ON orders(paypal_advance_amount)
  WHERE paypal_advance_amount > 0;

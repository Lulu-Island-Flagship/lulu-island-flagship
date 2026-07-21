-- Auditoría 2026-07-21 (INFORME_LOGICA_NEGOCIO_ROLES) — B-P2-1:
-- src/app/api/stripe/webhook/route.ts (handleRefund) restaba
-- charge.amount_refunded de orders.total_paid en cada evento
-- 'charge.refunded'. Ese campo de Stripe es el ACUMULADO de todo lo
-- reembolsado en el charge hasta ese momento, no el delta del reembolso
-- que disparó el evento -- dos reembolsos parciales en el mismo charge
-- sobre-restaban total_paid muy por debajo de lo realmente devuelto.
--
-- Esta columna guarda el último acumulado de Stripe conocido por orden,
-- para que el webhook pueda calcular el delta real (nuevo acumulado menos
-- el guardado) en vez de restar el acumulado completo cada vez.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS stripe_amount_refunded_cents INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN orders.stripe_amount_refunded_cents IS
  'Último acumulado de Stripe charge.amount_refunded (en centavos) procesado por el webhook para esta orden. Usado para calcular el delta real entre reembolsos parciales sucesivos y no sobre-restar total_paid. Ver auditoría 2026-07-21, B-P2-1.';

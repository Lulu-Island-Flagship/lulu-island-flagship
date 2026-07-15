-- Migración 152 — v8.3 E2.10: pago fraccionado 50/50 para órdenes >$500.
--
-- DISEÑO HONESTO: el mecanismo de cobro real (Hold T-72h vía cron
-- hold-authorize + saldo restante en Batch Capture 7PM) NO se modifica --
-- tocar esa cadena para partirla en dos cargos independientes de 50/50 es un
-- cambio de alto riesgo sobre el código de dinero más sensible del sistema y
-- queda fuera de esta migración. Lo que SÍ se construye aquí es la
-- elegibilidad, la elección del cliente y el desglose 50/50 como METADATA
-- auditable y visible desde la cotización -- la base necesaria para que,
-- cuando se decida modificar el flujo de captura, ya exista el dato de
-- "el cliente pidió fraccionar" y "cuánto es cada mitad" sin tener que
-- inventarlo retroactivamente.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS installment_plan_selected BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS installment_first_amount_cents INTEGER,
  ADD COLUMN IF NOT EXISTS installment_second_amount_cents INTEGER,
  ADD COLUMN IF NOT EXISTS installment_second_due_at TIMESTAMPTZ;

COMMENT ON COLUMN orders.installment_plan_selected IS
  'v8.3 E2.10: true si el cliente eligió pago fraccionado 50/50 al reservar (solo disponible para total > $500). Metadata informativa -- el cobro real sigue el flujo Hold+Batch existente, ver src/lib/installment-payment.ts para el detalle de la limitación.';

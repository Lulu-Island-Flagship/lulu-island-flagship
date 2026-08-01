-- Módulo de Cliente / Facturación -- fix de contrato de retorno de
-- record_client_payment() (auditoría 2026-07-31, hallazgo #15).
--
-- Contexto del bug: record_client_payment() (278) se declaró
-- `RETURNS client_payments` -- un pago, no una factura. payment-service.ts
-- ya documentaba esto como [ASSUMPTION]: "se asume que la función Postgres
-- real se implementa devolviendo también columnas invoice_status/
-- balance_due_cents junto a la fila de client_payments... si la función
-- finalmente NO expone esas columnas, este código deberá ajustarse". Al
-- verificar la migración 278 real: NO las expone -- `RETURNS client_payments`
-- solo puede devolver las columnas propias de esa tabla (id, client_id,
-- invoice_id, payment_method_id, amount_cents, payment_date,
-- provider_reference, status, created_at). En la práctica esto significa
-- que `row.invoice_status` SIEMPRE era `undefined` en TS, y el fallback
-- `row.invoice_status ?? row.status` terminaba devolviendo el STATUS DEL
-- PAGO ('completed', el único valor posible ya que la RPC inserta el pago
-- así siempre) etiquetado como si fuera el status de la FACTURA -- dos
-- conceptos distintos (un pago 'completed' no implica que la factura ya
-- esté 'paid'; puede seguir 'partially_paid'). Y `balance_due_cents`
-- SIEMPRE caía al fallback `?? 0`, aunque el saldo real casi nunca es 0.
--
-- Fix: se cambia la firma de retorno a RETURN TABLE con las columnas del
-- pago MÁS invoice_status/balance_due_cents explícitos -- los mismos
-- valores (v_new_status, v_new_balance_due_cents) que la función YA
-- calculaba y usaba para el UPDATE de client_invoices, ahora también
-- devueltos. Requiere DROP FUNCTION primero porque Postgres no permite
-- cambiar el tipo de retorno de una función existente con CREATE OR
-- REPLACE.

DROP FUNCTION IF EXISTS record_client_payment(UUID, UUID, UUID, INTEGER, TEXT);

CREATE OR REPLACE FUNCTION record_client_payment(
  p_invoice_id UUID,
  p_client_id UUID,
  p_payment_method_id UUID,
  p_amount_cents INTEGER,
  p_provider_reference TEXT
)
RETURNS TABLE (
  id UUID,
  client_id UUID,
  invoice_id UUID,
  payment_method_id UUID,
  amount_cents INTEGER,
  payment_date TIMESTAMPTZ,
  provider_reference TEXT,
  status TEXT,
  created_at TIMESTAMPTZ,
  invoice_status TEXT,
  balance_due_cents INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice client_invoices;
  v_new_amount_paid_cents INTEGER;
  v_new_balance_due_cents INTEGER;
  v_new_status TEXT;
  v_payment client_payments;
BEGIN
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'record_client_payment: p_amount_cents debe ser mayor a cero'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_invoice
  FROM client_invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'record_client_payment: la factura % no existe', p_invoice_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_invoice.client_id != p_client_id THEN
    RAISE EXCEPTION 'record_client_payment: la factura % no pertenece al cliente %', p_invoice_id, p_client_id
      USING ERRCODE = '22023';
  END IF;

  IF v_invoice.status = 'void' THEN
    RAISE EXCEPTION 'record_client_payment: no se puede registrar un pago sobre la factura % porque está anulada (void)', p_invoice_id
      USING ERRCODE = '22023';
  END IF;

  v_new_amount_paid_cents := v_invoice.amount_paid_cents + p_amount_cents;
  v_new_balance_due_cents := v_invoice.total_cents - v_new_amount_paid_cents;

  IF v_new_balance_due_cents < 0 THEN
    RAISE EXCEPTION 'record_client_payment: el pago de % centavos excede el saldo pendiente de % centavos de la factura % -- no se registra un balance negativo',
      p_amount_cents, v_invoice.balance_due_cents, p_invoice_id
      USING ERRCODE = '22023';
  END IF;

  IF v_new_balance_due_cents = 0 THEN
    v_new_status := 'paid';
  ELSIF v_new_amount_paid_cents > 0 THEN
    v_new_status := 'partially_paid';
  ELSE
    v_new_status := v_invoice.status;
  END IF;

  INSERT INTO client_payments (
    client_id, invoice_id, payment_method_id, amount_cents, provider_reference, status
  )
  VALUES (
    p_client_id, p_invoice_id, p_payment_method_id, p_amount_cents, p_provider_reference, 'completed'
  )
  RETURNING * INTO v_payment;

  UPDATE client_invoices
  SET amount_paid_cents = v_new_amount_paid_cents,
      balance_due_cents = v_new_balance_due_cents,
      status = v_new_status,
      updated_at = now()
  WHERE id = p_invoice_id;

  -- Fix hallazgo #15: se devuelven invoice_status/balance_due_cents
  -- explícitos (los mismos valores recién calculados y persistidos arriba)
  -- junto a las columnas del pago, en vez de forzar al caller a asumir
  -- (incorrectamente) que el status del PAGO representa el status de la
  -- FACTURA.
  RETURN QUERY SELECT
    v_payment.id, v_payment.client_id, v_payment.invoice_id, v_payment.payment_method_id,
    v_payment.amount_cents, v_payment.payment_date, v_payment.provider_reference, v_payment.status,
    v_payment.created_at, v_new_status, v_new_balance_due_cents;
END;
$$;

COMMENT ON FUNCTION record_client_payment IS
  'Módulo de Cliente / Facturación: registra atómicamente un pago YA '
  'CONFIRMADO por el procesador (no inicia el cobro) y actualiza '
  'amount_paid_cents/balance_due_cents/status de la factura en la misma '
  'transacción. Bloquea la factura con FOR UPDATE para evitar condición '
  'de carrera entre pagos concurrentes. Rechaza pagos sobre facturas '
  '"void" y pagos que dejarían un balance negativo. RETURNS TABLE incluye '
  'invoice_status/balance_due_cents explícitos (fix hallazgo #15, '
  'auditoría 2026-07-31) -- nunca confundir con el status del PAGO, que '
  'siempre es ''completed''.';

REVOKE ALL ON FUNCTION record_client_payment FROM PUBLIC;
REVOKE ALL ON FUNCTION record_client_payment FROM anon;
REVOKE ALL ON FUNCTION record_client_payment FROM authenticated;
GRANT EXECUTE ON FUNCTION record_client_payment TO service_role;

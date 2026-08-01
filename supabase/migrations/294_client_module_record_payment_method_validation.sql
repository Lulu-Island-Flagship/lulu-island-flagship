-- Módulo de Cliente / Facturación -- fix de validación de método de pago en
-- record_client_payment() (auditoría externa 2026-07-31, hallazgo confirmado).
--
-- Contexto del bug: record_client_payment (278, luego 291) recibe
-- p_payment_method_id y lo persiste tal cual en client_payments, pero NUNCA
-- verificaba que:
--   (a) el método de pago realmente pertenezca al client_id de la factura
--       (podía registrarse un pago usando el payment_method_id de OTRO
--       cliente -- cross-tenant, dato de facturación cruzado entre clientes),
--   (b) el método siga activo (status = 'active'; client_payment_methods.status
--       también admite 'expired'/'removed' -- ver migración 275), ni
--   (c) el método no esté vencido (expiry_month/expiry_year, para
--       credit_card/pad) -- podía registrarse un pago "exitoso" contra una
--       tarjeta ya expirada en nuestros propios registros, produciendo un
--       client_payments.status='completed' que no refleja un cobro real
--       verificable.
--
-- Fix: se agrega una validación explícita contra client_payment_methods
-- ANTES de insertar el pago, dentro de la misma transacción/FOR UPDATE que
-- ya bloqueaba la factura -- mismo patrón que el resto de esta función
-- (fallar ruidoso con RAISE EXCEPTION en vez de aceptar datos inconsistentes
-- silenciosamente).

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
  v_payment_method client_payment_methods;
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

  -- Fix (auditoría externa 2026-07-31): el método de pago debe existir,
  -- pertenecer al mismo cliente de la factura, y estar activo -- se bloquea
  -- también con FOR UPDATE para que no pueda cambiarse de estado (ej. un
  -- DELETE lógico a 'removed') entre la validación y el INSERT del pago.
  SELECT * INTO v_payment_method
  FROM client_payment_methods
  WHERE id = p_payment_method_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'record_client_payment: el método de pago % no existe', p_payment_method_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_payment_method.client_id != p_client_id THEN
    RAISE EXCEPTION 'record_client_payment: el método de pago % no pertenece al cliente %', p_payment_method_id, p_client_id
      USING ERRCODE = '22023';
  END IF;

  IF v_payment_method.status != 'active' THEN
    RAISE EXCEPTION 'record_client_payment: el método de pago % no está activo (status=%)', p_payment_method_id, v_payment_method.status
      USING ERRCODE = '22023';
  END IF;

  -- Vencimiento: solo aplica a credit_card/pad (los únicos con
  -- expiry_month/expiry_year poblados -- ver CHECK de la migración 275).
  -- Comparación calendario: vencida si (año, mes) del método es anterior al
  -- (año, mes) actual -- una tarjeta "12/2026" sigue siendo válida durante
  -- todo diciembre de 2026.
  IF v_payment_method.expiry_year IS NOT NULL AND v_payment_method.expiry_month IS NOT NULL THEN
    IF (v_payment_method.expiry_year, v_payment_method.expiry_month) <
       (EXTRACT(YEAR FROM now())::INT, EXTRACT(MONTH FROM now())::INT) THEN
      RAISE EXCEPTION 'record_client_payment: el método de pago % está vencido (%/%)',
        p_payment_method_id, v_payment_method.expiry_month, v_payment_method.expiry_year
        USING ERRCODE = '22023';
    END IF;
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
  'transacción. Bloquea la factura y el método de pago con FOR UPDATE. '
  'Valida que el método de pago pertenezca al cliente de la factura, esté '
  'activo (status=''active'') y no esté vencido (fix auditoría externa '
  '2026-07-31). Rechaza pagos sobre facturas "void" y pagos que dejarían '
  'un balance negativo. RETURNS TABLE incluye invoice_status/'
  'balance_due_cents explícitos (fix hallazgo #15, auditoría 2026-07-31).';

REVOKE ALL ON FUNCTION record_client_payment FROM PUBLIC;
REVOKE ALL ON FUNCTION record_client_payment FROM anon;
REVOKE ALL ON FUNCTION record_client_payment FROM authenticated;
GRANT EXECUTE ON FUNCTION record_client_payment TO service_role;

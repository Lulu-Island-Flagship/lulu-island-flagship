-- Módulo de Cliente -- Facturación (4/4). `client_payments` guarda cada
-- pago aplicado a una factura, y `record_client_payment()` es la función
-- RPC atómica que lo registra y actualiza el estado de la factura --
-- mismo patrón de función SECURITY DEFINER con row lock que
-- `set_current_fixed_costs` (249) y `set_system_setting` (252).
--
-- Por qué `client_id`/`invoice_id` son ON DELETE RESTRICT: mismo
-- principio que `client_invoices.client_id` (276) -- un pago es un
-- registro financiero/fiscal, nunca se borra en cascada por eliminar el
-- cliente o (en teoría, no debería ocurrir) la factura.
--
-- Por qué `payment_method_id` es ON DELETE SET NULL: a diferencia de
-- client_id/invoice_id, el método de pago es un dato de conveniencia
-- (qué tarjeta/PAD se usó) -- si el método se elimina o el token expira y
-- se limpia después, el pago histórico (amount_cents, status,
-- provider_reference) debe sobrevivir intacto, solo pierde el enlace
-- hacia el método específico usado.

CREATE TABLE IF NOT EXISTS client_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- RESTRICT: registro financiero/fiscal, nunca se borra en cascada.
  client_id UUID REFERENCES clients(id) ON DELETE RESTRICT,
  invoice_id UUID REFERENCES client_invoices(id) ON DELETE RESTRICT,
  -- SET NULL: dato de conveniencia, el pago histórico sobrevive a la
  -- eliminación del método de pago usado.
  payment_method_id UUID REFERENCES client_payment_methods(id) ON DELETE SET NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  payment_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Id de transacción del procesador (Stripe/Moneris/PayPal) -- NUNCA
  -- datos de tarjeta. Ver regla PCI-DSS SAQ-A en 275.
  provider_reference TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_payments_client_id ON client_payments (client_id);
CREATE INDEX IF NOT EXISTS idx_client_payments_invoice_id ON client_payments (invoice_id);
CREATE INDEX IF NOT EXISTS idx_client_payments_status ON client_payments (status);

ALTER TABLE client_payments ENABLE ROW LEVEL SECURITY;

-- Service-role-only, sin ninguna policy permisiva -- mismo patrón que el
-- resto de las tablas de este módulo (269-277).
DROP POLICY IF EXISTS "client_payments no direct access" ON client_payments;
CREATE POLICY "client_payments no direct access" ON client_payments
  FOR ALL USING (false) WITH CHECK (false);

COMMENT ON TABLE client_payments IS
  'Módulo de Cliente / Facturación: pagos aplicados a una factura. '
  'client_id/invoice_id son ON DELETE RESTRICT -- registro financiero/'
  'fiscal que nunca se borra en cascada. provider_reference es el id de '
  'transacción del procesador, NUNCA datos de tarjeta (PCI-DSS SAQ-A, ver '
  '275). Se inserta exclusivamente vía record_client_payment(). Acceso '
  'exclusivo vía service role.';

-- Función RPC atómica: registra un pago YA CONFIRMADO por el procesador
-- (Stripe/Moneris/PayPal) y actualiza el saldo/estado de la factura en la
-- misma transacción. IMPORTANTE: esta función NO inicia un cobro ni se
-- comunica con el procesador de pagos -- asume que el cobro ya fue
-- exitoso *antes* de llamarla (el caller TS confirma el webhook/respuesta
-- del procesador primero, y solo entonces llama a esta RPC para dejar
-- constancia contable). Por eso el pago se inserta directo con
-- `status = 'completed'`.
--
-- Bloquea la fila de `client_invoices` con FOR UPDATE para serializar dos
-- pagos concurrentes sobre la misma factura (mismo patrón que
-- `set_current_fixed_costs`, 249, y `set_system_setting`, 252) -- sin el
-- lock, dos pagos simultáneos podrían leer el mismo amount_paid_cents
-- antes de que ninguno lo actualice y perder uno de los dos incrementos
-- (lost update).
CREATE OR REPLACE FUNCTION record_client_payment(
  p_invoice_id UUID,
  p_client_id UUID,
  p_payment_method_id UUID,
  p_amount_cents INTEGER,
  p_provider_reference TEXT
)
RETURNS client_payments
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
  IF NOT is_supervisor(auth.uid()) THEN
    RAISE EXCEPTION 'Only supervisors can record payments'
      USING ERRCODE = '42501';
  END IF;

  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'record_client_payment: p_amount_cents debe ser mayor a cero'
      USING ERRCODE = '22023';
  END IF;

  -- Bloquea la fila de la factura para serializar pagos concurrentes
  -- sobre la misma factura -- ver comentario de cabecera.
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

  -- Fallar ruidoso ante dato inconsistente: un pago que excede el saldo
  -- pendiente indica un error upstream (monto mal calculado, doble envío,
  -- factura equivocada) -- nunca se deja un balance_due_cents negativo
  -- silenciosamente.
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

  -- El pago se inserta ya como 'completed': esta RPC registra un cobro
  -- que el procesador ya confirmó, no lo inicia -- ver comentario de
  -- cabecera.
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

  RETURN v_payment;
END;
$$;

COMMENT ON FUNCTION record_client_payment IS
  'Módulo de Cliente / Facturación: registra atómicamente un pago YA '
  'CONFIRMADO por el procesador (no inicia el cobro) y actualiza '
  'amount_paid_cents/balance_due_cents/status de la factura en la misma '
  'transacción. Bloquea la factura con FOR UPDATE para evitar condición '
  'de carrera entre pagos concurrentes. Rechaza pagos sobre facturas '
  '"void" y pagos que dejarían un balance negativo (falla ruidoso ante '
  'dato inconsistente en vez de permitirlo).';

-- Fix de seguridad (auditoría): la función record_client_payment se creó
-- originalmente como SECURITY DEFINER sin guard de autorización interno ni
-- REVOKE/GRANT explícito, quedando expuesta a PUBLIC por default de Postgres.
-- Se agrega:
--   1. Guard inline `is_supervisor(auth.uid())` -- mismo patrón que
--      redispatch_order_atomic (287) y receive_purchase_order (247/316).
--   2. REVOKE explícito de PUBLIC, anon y authenticated; GRANT a
--      authenticated (el guard interno restringe a supervisores reales).
REVOKE ALL ON FUNCTION record_client_payment(UUID, UUID, UUID, INTEGER, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_client_payment(UUID, UUID, UUID, INTEGER, TEXT) FROM anon;
REVOKE ALL ON FUNCTION record_client_payment(UUID, UUID, UUID, INTEGER, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION record_client_payment(UUID, UUID, UUID, INTEGER, TEXT) TO authenticated;

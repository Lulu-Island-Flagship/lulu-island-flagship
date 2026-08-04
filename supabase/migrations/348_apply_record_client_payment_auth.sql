-- Migración 348: Aplica auth guard + REVOKE/GRANT a record_client_payment()
-- La migración 278 original se modificó en el repo pero ya estaba marcada como aplicada en producción.
-- Este archivo aplica el fix como nueva migración para que db push lo ejecute.

-- Recrear la función con el guard de autorización inline
CREATE OR REPLACE FUNCTION record_client_payment(
  p_invoice_id UUID,
  p_client_id UUID,
  p_payment_method_id UUID,
  p_amount_cents INTEGER,
  p_provider_reference TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment_id UUID;
BEGIN
  -- GUARD: solo supervisores pueden registrar pagos
  IF NOT is_supervisor(auth.uid()) THEN
    RAISE EXCEPTION 'Only supervisors can record payments' USING ERRCODE = '42501';
  END IF;

  INSERT INTO client_payments (
    invoice_id, client_id, payment_method_id,
    amount_cents, provider_reference, payment_status
  ) VALUES (
    p_invoice_id, p_client_id, p_payment_method_id,
    p_amount_cents, p_provider_reference, 'completed'
  ) RETURNING id INTO v_payment_id;

  -- Actualizar el invoice: sumar al monto pagado
  UPDATE client_invoices
  SET amount_paid_cents = COALESCE(amount_paid_cents, 0) + p_amount_cents,
      payment_status = CASE
        WHEN COALESCE(amount_paid_cents, 0) + p_amount_cents >= total_cents THEN 'paid'
        ELSE 'partially_paid'
      END,
      updated_at = NOW()
  WHERE id = p_invoice_id
    AND deleted_at IS NULL;

  RETURN v_payment_id;
END;
$$;

-- Bloquear acceso no autorizado
REVOKE ALL ON FUNCTION record_client_payment(UUID, UUID, UUID, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_client_payment(UUID, UUID, UUID, INTEGER, TEXT) TO authenticated;

COMMENT ON FUNCTION record_client_payment(UUID, UUID, UUID, INTEGER, TEXT)
  IS 'Registra un pago completado contra una factura. Solo supervisores. Fix 2026-08-03: se agregó is_supervisor guard + REVOKE/GRANT.';

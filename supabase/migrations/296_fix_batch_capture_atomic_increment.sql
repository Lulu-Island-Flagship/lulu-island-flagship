-- Fix (auditoría externa 2026-07-31, hallazgo confirmado -- CRÍTICO):
-- src/app/api/cron/batch-capture/route.ts y
-- src/app/api/cron/batch-capture-retry/route.ts escribían el resultado de
-- una captura con un UPDATE que SOBREESCRIBE total_paid_cents/
-- card_amount_charged_cents/capture_authorized_amount con un valor
-- calculado en JS (`amountChargedCents + ...`), no con un incremento.
--
-- Escenario real donde esto pierde dinero ya contabilizado: el Hold de una
-- orden se captura y se reconcilia vía reconcileCapturedPaymentIntent
-- (payment-capture-reconciliation.ts, Caso 1) -- esa función SÍ suma
-- correctamente (`total_paid_cents = total_paid_cents + amountReceivedCents`)
-- y marca hold_captured_at. Si el cobro del SALDO falla esa misma noche
-- (7PM) y se reintenta a las 10PM (batch-capture-retry), el guard
-- `!order.hold_captured_at` correctamente evita volver a capturar el Hold
-- en Stripe -- pero `amountChargedCents` en ese reintento entonces NO
-- incluye el monto del Hold (ya estaba capturado), y el UPDATE final
-- reemplazaba total_paid_cents con SOLO el monto del saldo recién cobrado,
-- BORRANDO el monto del Hold que la reconciliación ya había sumado
-- correctamente. Incluso sin esa carrera puntual, el patrón "SET valor
-- calculado" en vez de "SET columna = columna + delta" es frágil ante
-- cualquier escritura concurrente al mismo pedido.
--
-- Fix: una función RPC atómica (mismo patrón que capture_installment_second_atomic
-- / capture_remainder_atomic, migración 292) que incrementa total_paid_cents/
-- card_amount_charged_cents/capture_authorized_amount con `columna = columna
-- + delta` calculado por Postgres en la misma sentencia UPDATE, y preserva
-- (en vez de sobreescribir a NULL) hold_captured_at/capture_captured_at
-- cuando esta ejecución no capturó esa pieza. `p_amount_captured_delta_cents`
-- ya representa SOLO el dinero nuevo capturado por Stripe en esta ejecución
-- (el guard `!order.hold_captured_at` en el caller ya evita que incluya un
-- Hold ya capturado antes), así que sumarlo es seguro y correcto.
--
-- También ataca parcialmente el hallazgo #7 (auditoría): capture_authorized_amount
-- es una columna en DÓLARES (fuera de alcance de RAÍZ-3, migración 229) que
-- el código convertía con `Math.round(amountChargedCents / 100)` y
-- SOBREESCRIBÍA -- mismo patrón de pérdida que total_paid_cents. Aquí se
-- corrige la pérdida por sobreescritura (ahora también es un incremento),
-- pero la columna SIGUE en dólares con redondeo con pérdida de precisión de
-- centavos -- convertirla a centavos es un cambio de esquema más amplio,
-- fuera de alcance de este fix (documentado, no resuelto aquí).

CREATE OR REPLACE FUNCTION apply_batch_capture_result(
  p_order_id UUID,
  p_amount_captured_delta_cents INTEGER,
  p_wallet_applied_delta_cents INTEGER,
  p_paypal_advance_delta_cents INTEGER,
  p_hold_payment_intent_id TEXT,
  p_balance_payment_intent_id TEXT
)
RETURNS TABLE (success BOOLEAN, reason TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated_id UUID;
  v_total_delta_cents INTEGER;
  v_capture_authorized_delta_dollars INTEGER;
BEGIN
  IF current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'apply_batch_capture_result: solo llamadas server-side pueden aplicar esta captura'
      USING ERRCODE = '42501';
  END IF;

  IF p_amount_captured_delta_cents IS NULL OR p_amount_captured_delta_cents < 0 THEN
    RETURN QUERY SELECT FALSE, 'invalid_amount'::TEXT;
    RETURN;
  END IF;

  v_total_delta_cents :=
    p_amount_captured_delta_cents +
    COALESCE(p_wallet_applied_delta_cents, 0) +
    COALESCE(p_paypal_advance_delta_cents, 0);

  -- capture_authorized_amount sigue en DÓLARES (ver comentario de cabecera)
  -- -- se preserva la misma conversión Math.round(cents/100) que ya usaba
  -- el caller, ahora aplicada al delta en vez de al total absoluto.
  v_capture_authorized_delta_dollars := ROUND(p_amount_captured_delta_cents / 100.0);

  UPDATE orders
  SET
    hold_captured_at = CASE
      WHEN p_hold_payment_intent_id IS NOT NULL THEN COALESCE(hold_captured_at, NOW())
      ELSE hold_captured_at
    END,
    stripe_capture_payment_intent_id = COALESCE(p_balance_payment_intent_id, stripe_capture_payment_intent_id),
    -- Fix: antes se ponía NULL explícitamente cuando esta ejecución no
    -- cobraba saldo (payments.balance ausente) -- eso borraba un
    -- capture_captured_at ya seteado por una ejecución previa. Ahora solo
    -- se setea (una vez, vía COALESCE) cuando SÍ hay saldo cobrado esta vez.
    capture_captured_at = CASE
      WHEN p_balance_payment_intent_id IS NOT NULL THEN COALESCE(capture_captured_at, NOW())
      ELSE capture_captured_at
    END,
    capture_authorized_amount = COALESCE(capture_authorized_amount, 0) + v_capture_authorized_delta_dollars,
    total_paid_cents = COALESCE(total_paid_cents, 0) + v_total_delta_cents,
    card_amount_charged_cents = COALESCE(card_amount_charged_cents, 0) + p_amount_captured_delta_cents,
    capture_attempts = 0,
    capture_last_error = NULL,
    updated_at = NOW()
  WHERE id = p_order_id
  RETURNING id INTO v_updated_id;

  IF v_updated_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'order_not_found'::TEXT;
  ELSE
    RETURN QUERY SELECT TRUE, 'ok'::TEXT;
  END IF;
END;
$$;

COMMENT ON FUNCTION apply_batch_capture_result IS
  'Aplica de forma atómica (UPDATE de una sola sentencia, incrementos calculados en SQL) el resultado de una captura exitosa de batch-capture (7PM) o batch-capture-retry (10PM). total_paid_cents/card_amount_charged_cents/capture_authorized_amount se INCREMENTAN, nunca se sobreescriben -- evita perder un monto ya capturado y reflejado por una ejecución previa o por reconcileCapturedPaymentIntent (payment-capture-reconciliation.ts). hold_captured_at/capture_captured_at se preservan si esta ejecución no tocó esa pieza. Fix auditoría externa 2026-07-31.';

REVOKE ALL ON FUNCTION apply_batch_capture_result(UUID, INTEGER, INTEGER, INTEGER, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION apply_batch_capture_result(UUID, INTEGER, INTEGER, INTEGER, TEXT, TEXT) TO service_role;

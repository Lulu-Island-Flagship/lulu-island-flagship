-- Fix (auditoría externa, verificado 2026-07-31): condición de carrera de
-- doble conteo contable en dos crons de cobro (src/app/api/cron/
-- installment-second-capture/route.ts y src/app/api/cron/capture-remainder/
-- route.ts). Ambos seguían el mismo patrón no atómico:
--   1. SELECT total_paid_cents/card_amount_charged_cents de `orders`.
--   2. Sumar el monto cobrado EN JAVASCRIPT (previousTotalPaidCents + cents).
--   3. UPDATE plano con el valor ya sumado, sin ningún guard optimista
--      (sin `.is(campo_captured_at, null)` en el UPDATE mismo -- ya se había
--      filtrado en el SELECT inicial, pero eso no protege contra una
--      segunda ejecución concurrente entre el SELECT y el UPDATE).
--
-- Si dos invocaciones del mismo cron corrieran solapadas (Vercel cron
-- reintentando, o un operador disparando el endpoint manualmente mientras
-- el cron programado también corre), ambas podrían leer el mismo valor
-- "antes", sumar el mismo monto, y la segunda escritura pisaría (no
-- duplicaría exactamente, pero sí perdería) el incremento de la primera --
-- o, según el orden de ejecución, contarlo dos veces si el monto capturado
-- también se refleja en shadow_ledger_entries dos veces (que si tiene una
-- idempotencyKey determinística por PaymentIntent, pero el UPDATE de
-- `orders` no la tiene).
--
-- Mismo patrón de solución que commit_capacity_slot (migración 242) y
-- apply_wallet_delta (migración 180/233): un UPDATE atómico de una sola
-- sentencia SQL, con el incremento calculado POR POSTGRES (no en JS) y el
-- guard de idempotencia (`captured_at IS NULL`) en el WHERE del mismo
-- UPDATE -- así la fila se bloquea y se verifica en la misma operación
-- atómica, sin ventana entre "leer" y "escribir".
--
-- Se agrega también, para installment-second-capture, la validación de que
-- la primera mitad (hold) ya se haya cobrado (hold_captured_at IS NOT NULL)
-- antes de cobrar la segunda -- el cron original no la exigía y podía
-- intentar cobrar la segunda mitad de un plan cuya primera mitad nunca se
-- capturó (tarjeta rechazada en el hold, etc.), lo cual no es un doble
-- cobro pero sí una secuencia de cobro incorrecta para un "50/50".

-- ============================================================
-- capture_installment_second_atomic: aplica el resultado de la captura de
-- la segunda mitad de un plan de pago fraccionado de forma atómica.
-- ============================================================
CREATE OR REPLACE FUNCTION capture_installment_second_atomic(
  p_order_id UUID,
  p_payment_intent_id TEXT,
  p_amount_cents INTEGER
)
RETURNS TABLE (success BOOLEAN, reason TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated_id UUID;
BEGIN
  -- Mismo guard que commit_capacity_slot / apply_wallet_delta: solo
  -- llamadas server-side (cron con SUPABASE_SERVICE_ROLE_KEY) pueden mutar
  -- el estado de captura de una orden ajena.
  -- auth.uid() lee el JWT de la sesión real (no current_user, que en
  -- SECURITY DEFINER devuelve el dueño de la función, no el caller).
  -- auth.uid() es NULL para llamadas service_role (sin sesión JWT).
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION
      'capture_installment_second_atomic: solo llamadas server-side pueden aplicar esta captura'
      USING ERRCODE = '42501';
  END IF;

  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RETURN QUERY SELECT FALSE, 'invalid_amount'::TEXT;
    RETURN;
  END IF;

  UPDATE orders
  SET
    installment_second_captured_at = NOW(),
    installment_second_payment_intent_id = p_payment_intent_id,
    total_paid_cents = COALESCE(total_paid_cents, 0) + p_amount_cents,
    card_amount_charged_cents = COALESCE(card_amount_charged_cents, 0) + p_amount_cents,
    updated_at = NOW()
  WHERE id = p_order_id
    AND installment_second_captured_at IS NULL
    -- Ver comentario de cabecera: la segunda mitad nunca debe cobrarse antes
    -- de que la primera (el hold del flujo normal) ya se haya capturado.
    AND hold_captured_at IS NOT NULL
  RETURNING id INTO v_updated_id;

  IF v_updated_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'already_captured_or_hold_not_captured_yet'::TEXT;
  ELSE
    RETURN QUERY SELECT TRUE, 'ok'::TEXT;
  END IF;
END;
$$;

COMMENT ON FUNCTION capture_installment_second_atomic IS
  'Aplica de forma atómica (UPDATE de una sola sentencia, incremento calculado en SQL) el resultado de una captura exitosa de la segunda mitad de un plan de pago fraccionado. Exige hold_captured_at IS NOT NULL (la primera mitad ya cobrada) e idempotencia vía installment_second_captured_at IS NULL. Fix auditoría externa 2026-07-31.';

REVOKE ALL ON FUNCTION capture_installment_second_atomic(UUID, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION capture_installment_second_atomic(UUID, TEXT, INTEGER) TO service_role;

-- ============================================================
-- capture_remainder_atomic: aplica el resultado de la captura del
-- remanente diferido (24h tras una captura parcial por disputa) de forma
-- atómica.
-- ============================================================
CREATE OR REPLACE FUNCTION capture_remainder_atomic(
  p_order_id UUID,
  p_payment_intent_id TEXT,
  p_amount_cents INTEGER
)
RETURNS TABLE (success BOOLEAN, reason TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated_id UUID;
BEGIN
  -- auth.uid() lee el JWT de la sesión real (no current_user, que en
  -- SECURITY DEFINER devuelve el dueño de la función, no el caller).
  -- auth.uid() es NULL para llamadas service_role (sin sesión JWT).
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION
      'capture_remainder_atomic: solo llamadas server-side pueden aplicar esta captura'
      USING ERRCODE = '42501';
  END IF;

  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RETURN QUERY SELECT FALSE, 'invalid_amount'::TEXT;
    RETURN;
  END IF;

  UPDATE orders
  SET
    capture_remaining_captured_at = NOW(),
    capture_remaining_payment_intent_id = p_payment_intent_id,
    total_paid_cents = COALESCE(total_paid_cents, 0) + p_amount_cents,
    card_amount_charged_cents = COALESCE(card_amount_charged_cents, 0) + p_amount_cents,
    updated_at = NOW()
  WHERE id = p_order_id
    AND capture_remaining_captured_at IS NULL
  RETURNING id INTO v_updated_id;

  IF v_updated_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'already_captured'::TEXT;
  ELSE
    RETURN QUERY SELECT TRUE, 'ok'::TEXT;
  END IF;
END;
$$;

COMMENT ON FUNCTION capture_remainder_atomic IS
  'Aplica de forma atómica (UPDATE de una sola sentencia, incremento calculado en SQL) el resultado de una captura exitosa del remanente diferido (24h) de una captura parcial. Idempotencia vía capture_remaining_captured_at IS NULL. Fix auditoría externa 2026-07-31.';

REVOKE ALL ON FUNCTION capture_remainder_atomic(UUID, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION capture_remainder_atomic(UUID, TEXT, INTEGER) TO service_role;

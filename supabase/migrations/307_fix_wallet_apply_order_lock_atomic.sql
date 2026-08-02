-- Fix (auditoría de integridad de datos 2026-08-01, Agente 4): POST
-- /api/client/wallet/apply leía la orden (status, hold_captured_at,
-- capture_captured_at, wallet_amount_used_cents) en una consulta, calculaba
-- el monto a aplicar en JS, y solo DESPUÉS aplicaba el débito de billetera
-- (RPC apply_wallet_delta, migración 180) y actualizaba
-- orders.wallet_amount_used_cents en una llamada aparte. Si el cron de
-- Batch Capture (cron/batch-capture, corre a las 7PM) capturaba esa MISMA
-- orden en la ventana entre la lectura y la escritura de este endpoint, el
-- batch capture calculaba el monto a cobrar sin ver todavía el crédito de
-- billetera (porque `wallet_amount_used_cents` aún no se había escrito) y
-- cobraba el 100% por tarjeta/PayPal -- el cliente paga el total completo
-- Y pierde el crédito de billetera aplicado.
--
-- apply_wallet_delta ya bloquea (SELECT ... FOR UPDATE) la fila de
-- `client_wallets`, pero eso NO protege la fila de `orders`: el batch
-- capture no toca `client_wallets`, toca `orders` directamente.
--
-- Fix: una función RPC que hace SELECT ... FOR UPDATE sobre la fila de
-- `orders` ANTES de aplicar el débito de billetera, y mantiene ese lock
-- hasta que la función retorna (fin de la transacción implícita de la
-- función). Cualquier UPDATE concurrente sobre esa misma fila de `orders`
-- (ej. el UPDATE de captura del batch capture) queda bloqueado por
-- Postgres hasta que esta transacción hace commit -- cierra la ventana de
-- carrera por completo, en vez de solo protegerla del lado de la
-- billetera. La revalidación de elegibilidad (status='confirmed', no
-- capturada, sin crédito ya aplicado) se repite AQUÍ, bajo el lock, en vez
-- de confiar únicamente en la lectura previa del route.ts (que ocurrió
-- antes de tomar el lock y pudo quedar obsoleta).

CREATE OR REPLACE FUNCTION apply_wallet_credit_to_order(
  p_order_id UUID,
  p_user_id UUID,
  p_wallet_id UUID,
  p_apply_cents INTEGER,
  p_description TEXT
)
RETURNS TABLE (new_balance INTEGER, transaction_id UUID, order_id UUID, wallet_amount_used_cents INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_new_balance INTEGER;
  v_transaction_id UUID;
  v_wallet_user_id UUID;
BEGIN
  -- Fix (auditoría de seguridad, mismo patrón que migraciones 233/300/301
  -- 2026-08-01): esta función llama a apply_wallet_delta() DESDE DENTRO de
  -- otra función SECURITY DEFINER -- Postgres evalúa `current_user` dentro
  -- de esa llamada anidada como el OWNER de la función (no como el rol que
  -- originó la petición HTTP), así que el chequeo de "rol de confianza
  -- server-side" de apply_wallet_delta puede no discriminar de forma
  -- confiable en este contexto anidado. Se repite explícitamente aquí, al
  -- nivel externo, la misma validación de ownership que ya usa
  -- apply_wallet_delta: quien invoca este RPC debe ser el dueño autenticado
  -- de p_user_id/p_wallet_id (o una llamada server-side de confianza).
  IF current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
      RAISE EXCEPTION
        'apply_wallet_credit_to_order: solo el dueño autenticado de la wallet (o una llamada server-side) puede invocar esta función'
        USING ERRCODE = '42501';
    END IF;

    SELECT user_id INTO v_wallet_user_id FROM client_wallets WHERE id = p_wallet_id;
    IF NOT FOUND OR v_wallet_user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION
        'apply_wallet_credit_to_order: la wallet % no pertenece al usuario autenticado', p_wallet_id
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_apply_cents IS NULL OR p_apply_cents <= 0 THEN
    RAISE EXCEPTION 'p_apply_cents must be > 0';
  END IF;

  -- Lock de la fila de la orden: bloquea a cualquier otra transacción
  -- (incluido el UPDATE del batch capture) que intente tocar esta MISMA
  -- fila hasta que esta función termine.
  SELECT * INTO v_order
  FROM orders
  WHERE id = p_order_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;

  -- Revalidación bajo lock -- la lectura previa en el route.ts pudo quedar
  -- obsoleta entre que se leyó y que se pidió este lock.
  IF v_order.status IS DISTINCT FROM 'confirmed' THEN
    RAISE EXCEPTION 'ORDER_NOT_CONFIRMED: %', v_order.status;
  END IF;
  IF v_order.hold_captured_at IS NOT NULL OR v_order.capture_captured_at IS NOT NULL THEN
    RAISE EXCEPTION 'ORDER_ALREADY_CAPTURED';
  END IF;
  IF v_order.wallet_amount_used_cents IS NOT NULL AND v_order.wallet_amount_used_cents > 0 THEN
    RAISE EXCEPTION 'WALLET_CREDIT_ALREADY_APPLIED';
  END IF;

  -- Débito atómico de billetera (mismo RPC/lock de fila que ya usaba este
  -- endpoint, migración 180) -- se llama DENTRO de esta misma transacción,
  -- así que si algo falla después (el UPDATE de la orden más abajo), TODO
  -- se revierte junto, sin necesitar la reversión manual compensatoria que
  -- el route.ts hacía antes a mano.
  SELECT d.new_balance, d.transaction_id INTO v_new_balance, v_transaction_id
  FROM apply_wallet_delta(
    p_wallet_id,
    p_user_id,
    p_order_id,
    'debit',
    -p_apply_cents,
    p_description
  ) AS d;

  UPDATE orders
  SET wallet_amount_used_cents = p_apply_cents, updated_at = now()
  WHERE id = p_order_id;

  RETURN QUERY SELECT v_new_balance, v_transaction_id, p_order_id, p_apply_cents;
END;
$$;

REVOKE EXECUTE ON FUNCTION apply_wallet_credit_to_order(UUID, UUID, UUID, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION apply_wallet_credit_to_order(UUID, UUID, UUID, INTEGER, TEXT) TO authenticated, service_role;

COMMENT ON FUNCTION apply_wallet_credit_to_order IS
  'Fix integridad de datos 2026-08-01: reemplaza el read-then-write de POST /api/client/wallet/apply (leer orden, calcular en JS, aplicar débito de billetera, actualizar orden -- en llamadas separadas) por una única transacción que bloquea la fila de `orders` con FOR UPDATE antes de aplicar el crédito, cerrando la ventana de carrera con el batch capture (cron/batch-capture) que podía cobrar el 100% de una orden mientras un crédito de billetera se aplicaba en paralelo. Valida ownership explícitamente (ver comentario en el cuerpo) porque la llamada anidada a apply_wallet_delta() no discrimina de forma confiable el rol originador bajo SECURITY DEFINER anidado.';

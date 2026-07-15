-- v8.3 — Bug crítico encontrado en auditoría de flujo cliente (2026-07-15):
-- TODAS las mutaciones de client_wallets.balance en el código eran
-- lectura-luego-escritura sin bloqueo ni control de concurrencia:
--   SELECT balance -> calcular newBalance en JS -> UPDATE balance = newBalance
-- sin WHERE balance = <valor leído> (optimistic locking) ni SELECT ... FOR
-- UPDATE. Si dos procesos tocan la misma billetera casi al mismo tiempo
-- (dos crons superpuestos, doble clic del cliente en "aplicar crédito",
-- una cancelación reembolsando wallet mientras un cron de regalo corre),
-- el segundo UPDATE sobrescribe el saldo calculado por el primero con
-- datos obsoletos ("lost update" clásico) -- el saldo del cliente puede
-- terminar corrupto sin ningún mecanismo de reconciliación.
--
-- Fix: una función RPC atómica que hace SELECT ... FOR UPDATE (bloquea la
-- fila de la billetera hasta el commit), calcula el nuevo saldo DENTRO de
-- Postgres, inserta la transacción y actualiza el saldo -- todo en una
-- sola transacción. Dos llamadas concurrentes a la misma billetera se
-- serializan automáticamente por el lock de fila; ya no pueden pisarse.

CREATE OR REPLACE FUNCTION apply_wallet_delta(
  p_wallet_id UUID,
  p_user_id UUID,
  p_order_id UUID,
  p_type TEXT,
  p_delta INTEGER, -- positivo = aumenta el saldo, negativo = lo reduce
  p_description TEXT,
  p_expires_at TIMESTAMPTZ DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (new_balance INTEGER, transaction_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_balance INTEGER;
  v_new_balance INTEGER;
  v_transaction_id UUID;
BEGIN
  -- Bloquea la fila de la billetera hasta el COMMIT de esta transacción --
  -- cualquier otra llamada concurrente a apply_wallet_delta para el MISMO
  -- wallet_id espera aquí hasta que esta termine, eliminando la ventana de
  -- carrera por completo (a diferencia de un UPDATE ... WHERE balance = X,
  -- que solo DETECTA el conflicto después de que ya ocurrió).
  SELECT balance INTO v_current_balance
  FROM client_wallets
  WHERE id = p_wallet_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'client_wallets row % not found', p_wallet_id;
  END IF;

  v_new_balance := v_current_balance + p_delta;
  IF v_new_balance < 0 THEN
    RAISE EXCEPTION 'Wallet % balance would go negative (current=%, delta=%)', p_wallet_id, v_current_balance, p_delta;
  END IF;

  INSERT INTO wallet_transactions (wallet_id, user_id, order_id, type, amount, balance_after, description, expires_at, metadata)
  VALUES (p_wallet_id, p_user_id, p_order_id, p_type, p_delta, v_new_balance, p_description, p_expires_at, p_metadata)
  RETURNING id INTO v_transaction_id;

  UPDATE client_wallets
  SET balance = v_new_balance, updated_at = now()
  WHERE id = p_wallet_id;

  RETURN QUERY SELECT v_new_balance, v_transaction_id;
END;
$$;

COMMENT ON FUNCTION apply_wallet_delta IS
  'v8.3: mutación atómica de client_wallets.balance + wallet_transactions. Reemplaza el patrón read-then-write (lost-update) usado antes en admin/wallet, referral-credit-grant, birthday-gift, wallet/apply, pre-review-survey y orders/cancel.';

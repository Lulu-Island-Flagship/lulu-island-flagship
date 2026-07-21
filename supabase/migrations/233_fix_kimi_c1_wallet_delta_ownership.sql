-- Fix Kimi-C1 (auditoría externa Kimi Code, 2026-07-21, verificado por Claude
-- antes de aplicar -- el reporte de Kimi citaba el archivo inexistente
-- "164_wallet_system.sql"; la función real vive en 180_e2_wallet_atomic_rpc.sql).
--
-- apply_wallet_delta() es SECURITY DEFINER y NUNCA validó que quien la
-- invoca sea realmente el dueño de la wallet/usuario que declara en sus
-- parámetros (p_wallet_id, p_user_id). Dos rutas del cliente la llaman
-- usando la sesión propia del usuario (clave anon + cookies, NO
-- service_role): src/app/api/client/wallet/apply/route.ts y
-- src/app/api/client/pre-review-survey/route.ts. Verificado (grep,
-- 2026-07-21): ningún otro código del repo inserta directo en
-- wallet_transactions ni llama este RPC salvo esas dos rutas (sesión de
-- cliente) y admin/wallet, orders/cancel, cron/referral-credit-grant,
-- cron/birthday-gift (las 4 con SUPABASE_SERVICE_ROLE_KEY, confirmado por
-- grep).
--
-- Sin este fix: cualquier usuario autenticado podía invocar
-- supabase.rpc('apply_wallet_delta', { p_wallet_id: '<wallet de otro>',
-- p_user_id: '<user de otro>', p_delta: 999999, ... }) directo desde el
-- cliente (PostgREST expone todo RPC a `authenticated` salvo que se
-- restrinja explícitamente) y mover saldo arbitrario de CUALQUIER wallet,
-- sin pasar por ninguna ruta ni validación de la aplicación.
--
-- Fix: dentro de la función, si quien ejecuta NO es un rol de confianza
-- server-side (mismo patrón ya usado en la migración 214/230,
-- current_user IN ('service_role','postgres','supabase_admin')), se exige
-- que auth.uid() coincida con p_user_id Y que la wallet p_wallet_id
-- realmente pertenezca a ese usuario -- cerrando el vector de mover dinero
-- de OTRO usuario. CREATE OR REPLACE preserva toda la lógica original
-- (lock de fila, cálculo de balance, inserción de transacción) verbatim.
--
-- Riesgo residual documentado (fuera de alcance de este fix, requiere
-- diseño de negocio, no solo seguridad): un usuario autenticado podría
-- seguir llamando esta función directo para SU PROPIA wallet con un
-- p_type/p_delta arbitrario (ej. otorgarse crédito ilimitado), porque la
-- función no valida montos ni tipos por rol -- eso exige una tabla de
-- reglas de negocio por tipo de transacción que no existe hoy. Anotado
-- para una iteración futura; el fix de hoy cierra el vector más grave
-- (tocar la wallet de OTRO usuario).
CREATE OR REPLACE FUNCTION apply_wallet_delta(
  p_wallet_id UUID,
  p_user_id UUID,
  p_order_id UUID,
  p_type TEXT,
  p_delta INTEGER,
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
  v_wallet_user_id UUID;
BEGIN
  IF current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
      RAISE EXCEPTION
        'apply_wallet_delta: solo el dueño autenticado de la wallet (o una llamada server-side) puede invocar esta función'
        USING ERRCODE = '42501';
    END IF;

    SELECT user_id INTO v_wallet_user_id
    FROM client_wallets
    WHERE id = p_wallet_id;

    IF NOT FOUND OR v_wallet_user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION
        'apply_wallet_delta: la wallet % no pertenece al usuario autenticado', p_wallet_id
        USING ERRCODE = '42501';
    END IF;
  END IF;

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
  'v8.3 (migración 180) + fix Kimi-C1 (migración 233, 2026-07-21): mutación atómica '
  'de client_wallets.balance + wallet_transactions, con validación de propiedad '
  'para llamadas de sesión de cliente (auth.uid() debe ser dueño de p_user_id y '
  'de la wallet p_wallet_id). Las llamadas server-side (service_role/postgres/'
  'supabase_admin) no están sujetas a esta restricción.';

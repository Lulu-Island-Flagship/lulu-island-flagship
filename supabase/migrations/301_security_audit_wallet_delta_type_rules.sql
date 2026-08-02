-- Fix auditoría de seguridad externa (2026-08-01), issue Kimi-C1 continuado.
--
-- La migración 233 (fix Kimi-C1, 2026-07-21) cerró el vector de tocar la
-- wallet de OTRO usuario, pero dejó documentado como "riesgo residual fuera
-- de alcance" que un usuario autenticado podía seguir llamando
-- apply_wallet_delta() SOBRE SU PROPIA wallet con p_type='promo' y
-- p_delta=999999, auto-otorgándose crédito ilimitado -- porque la función no
-- validaba montos ni tipos por rol.
--
-- wallet_transactions.type solo admite ('credit','debit','refund','promo',
-- 'payout') (CHECK, migración 025). Verificado por grep quién llama
-- apply_wallet_delta con cada tipo:
--
--   'promo'  -> cron/referral-credit-grant, cron/birthday-gift (ambos
--               service_role) y admin/wallet (sesión de un owner_admin,
--               vía requireAdminRole('finance') -- ver src/lib/admin-rbac.ts,
--               'finance' solo permite el rol 'owner_admin'). NUNCA un
--               cliente normal.
--   'payout' -> ningún llamador actual en el repo (tipo reservado para
--               pagos a terceros). Se deja bloqueado para no-admin por
--               consistencia con 'promo'/'refund' (crédito discrecional).
--   'refund' -> orders/cancel (service_role) y admin/wallet (owner_admin).
--               NUNCA un cliente normal.
--   'credit' -> admin/wallet (owner_admin, monto arbitrario hasta el tope
--               de la ruta) Y TAMBIÉN dos rutas de sesión de CLIENTE:
--               client/wallet/apply (reversión de un débito propio previo,
--               mismo wallet+orden) y client/pre-review-survey (recompensa
--               fija de $10 = 1000 centavos por encuesta, atada a una orden
--               propia). Estos dos casos legítimos de auto-servicio se
--               acotan abajo con un tope conservador + orden real propia.
--   'debit'  -> client/wallet/apply (cliente gastando su propio saldo
--               contra una orden propia sin capturar todavía).
--
-- Fix: cuando quien invoca NO es un rol de confianza server-side
-- (service_role/postgres/supabase_admin) NI un owner_admin autenticado
-- (admin_roles.role = 'owner_admin'), se restringe por tipo:
--   - 'promo' / 'payout' / 'refund': SIEMPRE rechazado (créditos
--     discrecionales/administrativos, nunca de autoservicio).
--   - 'credit': exige una orden real (p_order_id) que pertenezca al
--     p_user_id autenticado, y limita el monto al máximo entre (a) lo que
--     ya se debitó de esa wallet para esa misma orden (reversión legítima,
--     nunca más de lo que el propio cliente puso) y (b) un tope fijo
--     conservador (SELF_SERVICE_CREDIT_CAP_CENTS = 2000 = $20, con margen
--     sobre el $10 fijo de la encuesta post-servicio).
--   - 'debit': exige una orden real y propia, todavía no capturada
--     (hold_captured_at/capture_captured_at ambos NULL, status='confirmed'),
--     y no permite debitar más del total de esa orden.
--
-- Además: agrega p_request_id (opcional) + columna
-- wallet_transactions.request_id con UNIQUE parcial, para idempotencia real
-- a nivel de base de datos (complementa, no reemplaza, el chequeo de
-- ventana de 10s ya agregado en admin/wallet/route.ts) -- una llamada
-- repetida con el mismo request_id devuelve la transacción ya creada en vez
-- de insertar una fila nueva, incluso bajo condiciones de carrera reales
-- entre dos requests concurrentes (el UNIQUE index resuelve eso a nivel de
-- DB, algo que ningún chequeo "leer últimos N segundos" en la app puede
-- garantizar).

ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS request_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS wallet_transactions_wallet_request_id_unique
  ON wallet_transactions (wallet_id, request_id)
  WHERE request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION apply_wallet_delta(
  p_wallet_id UUID,
  p_user_id UUID,
  p_order_id UUID,
  p_type TEXT,
  p_delta INTEGER,
  p_description TEXT,
  p_expires_at TIMESTAMPTZ DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_request_id TEXT DEFAULT NULL
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
  v_is_trusted BOOLEAN;
  v_is_owner_admin BOOLEAN;
  v_prior_debit_total INTEGER;
  v_order_total_cents INTEGER;
  v_self_service_credit_cap_cents CONSTANT INTEGER := 2000; -- $20 CAD
BEGIN
  v_is_trusted := current_user IN ('service_role', 'postgres', 'supabase_admin');

  -- Idempotencia real a nivel de DB: si ya existe una fila para esta misma
  -- wallet + request_id, se devuelve el resultado ya persistido en vez de
  -- insertar de nuevo (no falla con error -- una llamada repetida idéntica
  -- es un no-op observacionalmente exitoso, mismo contrato que un POST
  -- idempotente).
  IF p_request_id IS NOT NULL THEN
    SELECT id, balance_after INTO v_transaction_id, v_new_balance
    FROM wallet_transactions
    WHERE wallet_id = p_wallet_id AND request_id = p_request_id;

    IF FOUND THEN
      RETURN QUERY SELECT v_new_balance, v_transaction_id;
      RETURN;
    END IF;
  END IF;

  IF NOT v_is_trusted THEN
    -- Ownership (migración 233): quien llama debe ser el dueño autenticado
    -- del user_id/wallet declarados en los parámetros.
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

    -- ¿Es un owner_admin operando desde el panel admin? admin/wallet llama
    -- esta función con la sesión del ADMIN (no service_role), y p_user_id ahí
    -- es el CLIENTE beneficiario -- por eso el chequeo de ownership de
    -- arriba NO aplicaría para ese flujo salvo que se reconozca aquí
    -- explícitamente al owner_admin como caller de confianza para el resto
    -- de las reglas por tipo.
    SELECT EXISTS (
      SELECT 1 FROM admin_roles
      WHERE user_id = auth.uid() AND role = 'owner_admin' AND deleted_at IS NULL
    ) INTO v_is_owner_admin;

    IF NOT v_is_owner_admin THEN
      IF p_type IN ('promo', 'payout', 'refund') THEN
        RAISE EXCEPTION
          'apply_wallet_delta: el tipo "%" es un crédito discrecional/administrativo y solo puede otorgarlo service_role o un owner_admin', p_type
          USING ERRCODE = '42501';

      ELSIF p_type = 'credit' THEN
        IF p_order_id IS NULL THEN
          RAISE EXCEPTION
            'apply_wallet_delta: un crédito de autoservicio requiere una orden real (p_order_id)'
            USING ERRCODE = '42501';
        END IF;

        IF NOT EXISTS (SELECT 1 FROM orders WHERE id = p_order_id AND user_id = p_user_id) THEN
          RAISE EXCEPTION
            'apply_wallet_delta: la orden % no pertenece al usuario autenticado', p_order_id
            USING ERRCODE = '42501';
        END IF;

        SELECT COALESCE(SUM(-amount), 0) INTO v_prior_debit_total
        FROM wallet_transactions
        WHERE wallet_id = p_wallet_id AND order_id = p_order_id AND type = 'debit';

        IF p_delta > GREATEST(v_prior_debit_total, v_self_service_credit_cap_cents) THEN
          RAISE EXCEPTION
            'apply_wallet_delta: crédito de autoservicio de % centavos excede el máximo permitido (reversión previa=%, tope=%)',
            p_delta, v_prior_debit_total, v_self_service_credit_cap_cents
            USING ERRCODE = '42501';
        END IF;

      ELSIF p_type = 'debit' THEN
        IF p_order_id IS NULL THEN
          RAISE EXCEPTION
            'apply_wallet_delta: un débito de autoservicio requiere una orden real (p_order_id)'
            USING ERRCODE = '42501';
        END IF;

        SELECT ROUND(q.total)::INTEGER INTO v_order_total_cents
        FROM orders o
        JOIN quotes q ON q.id = o.quote_id
        WHERE o.id = p_order_id
          AND o.user_id = p_user_id
          AND o.status = 'confirmed'
          AND o.hold_captured_at IS NULL
          AND o.capture_captured_at IS NULL;

        IF v_order_total_cents IS NULL THEN
          RAISE EXCEPTION
            'apply_wallet_delta: la orden % no es una orden propia, confirmada y sin capturar', p_order_id
            USING ERRCODE = '42501';
        END IF;

        IF -p_delta > v_order_total_cents THEN
          RAISE EXCEPTION
            'apply_wallet_delta: débito de % centavos excede el total de la orden (% centavos)', -p_delta, v_order_total_cents
            USING ERRCODE = '42501';
        END IF;

      ELSE
        RAISE EXCEPTION 'apply_wallet_delta: tipo de transacción desconocido "%"', p_type
          USING ERRCODE = '42501';
      END IF;
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

  INSERT INTO wallet_transactions (wallet_id, user_id, order_id, type, amount, balance_after, description, expires_at, metadata, request_id)
  VALUES (p_wallet_id, p_user_id, p_order_id, p_type, p_delta, v_new_balance, p_description, p_expires_at, p_metadata, p_request_id)
  RETURNING id INTO v_transaction_id;

  UPDATE client_wallets
  SET balance = v_new_balance, updated_at = now()
  WHERE id = p_wallet_id;

  RETURN QUERY SELECT v_new_balance, v_transaction_id;
END;
$$;

-- Defensa en profundidad: anon (sin sesión) nunca debe poder ni intentar
-- invocar esta función (auth.uid() sería NULL y la función la rechazaría de
-- todas formas, pero no hace falta exponer la superficie de ataque).
REVOKE EXECUTE ON FUNCTION apply_wallet_delta(UUID, UUID, UUID, TEXT, INTEGER, TEXT, TIMESTAMPTZ, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION apply_wallet_delta(UUID, UUID, UUID, TEXT, INTEGER, TEXT, TIMESTAMPTZ, JSONB, TEXT) TO authenticated, service_role;

COMMENT ON FUNCTION apply_wallet_delta IS
  'v8.3 (migración 180) + fix Kimi-C1 (migración 233) + fix auditoría de '
  'seguridad externa (migración 301, 2026-08-01): mutación atómica de '
  'client_wallets.balance + wallet_transactions, con validación de '
  'propiedad (auth.uid() debe ser dueño de p_user_id y de la wallet '
  'p_wallet_id) Y de tipo de transacción para llamadas de sesión de '
  'cliente -- promo/payout/refund quedan reservados a service_role/'
  'owner_admin; credit/debit de autoservicio exigen una orden real propia '
  'y un monto acotado. Soporta p_request_id opcional para idempotencia '
  'real a nivel de DB (UNIQUE en wallet_transactions(wallet_id, '
  'request_id)). Las llamadas server-side (service_role/postgres/'
  'supabase_admin) no están sujetas a estas restricciones.';

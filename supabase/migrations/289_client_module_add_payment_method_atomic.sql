-- Módulo de Cliente / Facturación -- fix de atomicidad (auditoría
-- 2026-07-31, hallazgo #13). Mismo patrón que 268 (flujo de contratación)
-- y 281 (create_client_invoice_with_line_items).
--
-- Contexto del bug: addPaymentMethod() en payment-method-service.ts hacía
-- dos operaciones independientes sobre PostgREST -- un UPDATE para
-- desmarcar el default anterior y, después, un INSERT del método nuevo --
-- sin transacción real entre ambas (cada `.from(...).update/insert(...)`
-- es su propio round-trip HTTP). Si el proceso caía justo entre esas dos
-- llamadas (timeout de red, deploy a mitad de request, etc.), el cliente
-- podía quedar TEMPORALMENTE sin ningún método de pago default activo --
-- el índice único parcial (275) evita que haya DOS, pero no garantiza que
-- haya exactamente UNO en todo momento.
--
-- Fix: una función RPC SECURITY DEFINER que hace el UPDATE de desmarcado y
-- el INSERT del método nuevo dentro de una única transacción de Postgres
-- real -- si el INSERT falla (ej. viola un CHECK), el UPDATE de desmarcado
-- también se revierte, así que nunca queda un estado a medio camino.

CREATE OR REPLACE FUNCTION add_client_payment_method_atomic(
  p_client_id UUID,
  p_method_type TEXT,
  p_provider TEXT,
  p_provider_token TEXT,
  p_last_four TEXT,
  p_expiry_month SMALLINT,
  p_expiry_year SMALLINT,
  p_is_default BOOLEAN
)
RETURNS client_payment_methods
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_method client_payment_methods;
BEGIN
  IF p_client_id IS NULL THEN
    RAISE EXCEPTION 'add_client_payment_method_atomic: p_client_id es requerido'
      USING ERRCODE = '22023';
  END IF;

  -- Desmarca TODOS los métodos activos previos del cliente antes de
  -- insertar el nuevo -- mismo criterio ya documentado en
  -- payment-method-service.ts (invariante "a lo sumo un default activo por
  -- cliente"), ahora dentro de la misma transacción que el INSERT.
  IF p_is_default THEN
    UPDATE client_payment_methods
    SET is_default = false, updated_at = now()
    WHERE client_id = p_client_id
      AND status = 'active'
      AND is_default = true;
  END IF;

  INSERT INTO client_payment_methods (
    client_id, method_type, provider, provider_token, last_four,
    expiry_month, expiry_year, is_default, status
  ) VALUES (
    p_client_id, p_method_type, p_provider, p_provider_token, p_last_four,
    p_expiry_month, p_expiry_year, COALESCE(p_is_default, false), 'active'
  )
  RETURNING * INTO v_method;

  RETURN v_method;
END;
$$;

COMMENT ON FUNCTION add_client_payment_method_atomic IS
  'Módulo de Cliente / Facturación: desmarca el método de pago default '
  'anterior (si p_is_default) e inserta el nuevo, en una sola transacción '
  'atómica (fix hallazgo #13, auditoría 2026-07-31). El índice único '
  'parcial (275) queda como red de seguridad adicional, no como el único '
  'mecanismo.';

-- Mismo régimen de acceso que el resto del módulo (269-281): ni anon ni
-- authenticated pueden ejecutar esto directamente -- client_payment_methods
-- es service-role-only (275).
REVOKE ALL ON FUNCTION add_client_payment_method_atomic FROM PUBLIC;
REVOKE ALL ON FUNCTION add_client_payment_method_atomic FROM anon;
REVOKE ALL ON FUNCTION add_client_payment_method_atomic FROM authenticated;
GRANT EXECUTE ON FUNCTION add_client_payment_method_atomic TO service_role;

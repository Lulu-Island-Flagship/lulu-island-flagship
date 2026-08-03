-- Fix (auditoría externa 2026-07-24, dinero real confirmado -- checkout /
-- src/app/api/stripe/confirm/route.ts): bug de sobreventa real de capacidad.
--
-- Secuencia anterior en confirm/route.ts (aprox líneas 523-768 antes de este
-- fix):
--   1. SELECT committed_teams/max_teams del slot (sin lock).
--   2. Chequeo en memoria "hay espacio" (slotAvailable), sin ningún lock --
--      pura lectura, cualquier otra request puede leer el mismo estado al
--      mismo tiempo.
--   3. INSERT de la orden COMPLETA -- el cliente ya queda comprometido con
--      la reserva en este punto, con el pago ya verificado contra Stripe/
--      PayPal arriba en el mismo request.
--   4. Recién DESPUÉS, UPDATE de committed_teams con optimistic lock
--      (.eq("committed_teams", slotRow.committed_teams)).
--   5. Si el UPDATE optimista fallaba (CAS falla porque otra request ya
--      cambió committed_teams mientras tanto), el código SOLO logueaba el
--      error y NO revertía la orden ya creada.
--
-- El optimistic lock del paso 4 evitaba que el CONTADOR se corrompiera
-- (nunca se sobrescribía con un valor obsoleto), pero NO evitaba la
-- sobreventa real: dos requests concurrentes podían ambos leer "hay
-- espacio" en el paso 2 (antes de que ninguno de los dos hubiera escrito
-- nada todavía) y ambos completar el paso 3 -- dos órdenes pagadas y
-- confirmadas para un slot que solo tenía cupo para una. El chequeo de
-- disponibilidad (paso 2) y la reserva del cupo (paso 4) estaban separados
-- por un INSERT completo de orden en medio, la ventana de carrera clásica
-- TOCTOU (time-of-check to time-of-use).
--
-- Mismo patrón ya usado para resolver el problema equivalente en
-- client_wallets (ver apply_wallet_delta, migración 180 + fix de propiedad
-- en 233): una función RPC de Postgres que hace SELECT ... FOR UPDATE
-- (bloquea la fila hasta el commit), verifica la condición de negocio
-- DENTRO de esa misma transacción bloqueada, y solo entonces escribe. Dos
-- llamadas concurrentes al mismo slot se serializan automáticamente por el
-- lock de fila -- ya no hay ventana entre "leer disponibilidad" y
-- "reservar cupo" en la que otra request pueda colarse.
--
-- confirm/route.ts se modifica en la misma fecha para invocar este RPC
-- ANTES de insertar la orden: si el RPC confirma que hay espacio, recién
-- ahí se procede a crear la orden (que ya cobró/verificó el pago arriba);
-- si el RPC dice que no hay espacio, se aborta con 409 ANTES de tocar la
-- tabla `orders`, así nunca se llega a tener una orden pagada sin capacidad
-- real. El UPDATE optimista posterior al INSERT (pasos 4-5 de arriba) se
-- elimina por completo -- ya no hace falta, la reserva de capacidad ocurre
-- antes y de forma atómica.

-- ============================================================
-- commit_capacity_slot: reserva atómica de cupo en un capacity_slot.
-- ============================================================
CREATE OR REPLACE FUNCTION commit_capacity_slot(
  p_slot_id UUID,
  p_teams_needed INTEGER DEFAULT 1
)
RETURNS TABLE (success BOOLEAN, committed_teams INTEGER, max_teams INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_committed_teams INTEGER;
  v_max_teams INTEGER;
  v_slot_type TEXT;
  v_new_committed INTEGER;
BEGIN
  -- capacity_slots es disponibilidad operativa compartida, no un dato
  -- propiedad del cliente (ver nota en confirm/route.ts) -- solo llamadas
  -- server-side (service_role, vía getServiceRoleClient()) deben poder
  -- comprometer cupo. Mismo guard que apply_wallet_delta (migración 233):
  -- sin esto, cualquier usuario autenticado podría invocar este RPC
  -- repetidamente contra un slot ajeno y llenarlo de "cupo comprometido"
  -- sin crear ninguna orden real, bloqueando reservas legítimas de otros
  -- clientes (denegación de servicio sobre la capacidad, no solo un riesgo
  -- de dinero).
  -- auth.uid() lee el JWT de la sesión real (no current_user, que en
  -- SECURITY DEFINER devuelve el dueño de la función, no el caller).
  -- auth.uid() es NULL para llamadas service_role (sin sesión JWT).
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION
      'commit_capacity_slot: solo llamadas server-side pueden comprometer capacidad'
      USING ERRCODE = '42501';
  END IF;

  IF p_teams_needed IS NULL OR p_teams_needed <= 0 THEN
    RAISE EXCEPTION 'commit_capacity_slot: p_teams_needed debe ser un entero positivo (recibido %)', p_teams_needed;
  END IF;

  -- Bloquea la fila del slot hasta el COMMIT de esta transacción --
  -- cualquier otra llamada concurrente a commit_capacity_slot para el MISMO
  -- slot espera aquí hasta que esta termine, eliminando la ventana de
  -- carrera TOCTOU por completo (a diferencia de leer y decidir en la
  -- aplicación, y recién validar con un UPDATE ... WHERE committed_teams = X
  -- más tarde, que solo DETECTA el conflicto después de que la orden ya se
  -- creó).
  SELECT committed_teams, max_teams, slot_type
  INTO v_committed_teams, v_max_teams, v_slot_type
  FROM capacity_slots
  WHERE id = p_slot_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'capacity_slots row % not found', p_slot_id;
  END IF;

  -- Sin espacio (o slot bloqueado manualmente): no se modifica nada, se
  -- señala el fallo con claridad para que el caller pueda abortar la
  -- creación de la orden ANTES de insertarla.
  IF v_slot_type = 'blocked' OR (v_committed_teams + p_teams_needed) > v_max_teams THEN
    RETURN QUERY SELECT false, v_committed_teams, v_max_teams;
    RETURN;
  END IF;

  v_new_committed := v_committed_teams + p_teams_needed;

  UPDATE capacity_slots
  SET committed_teams = v_new_committed, updated_at = now()
  WHERE id = p_slot_id;

  RETURN QUERY SELECT true, v_new_committed, v_max_teams;
END;
$$;

COMMENT ON FUNCTION commit_capacity_slot IS
  'Fix 2026-07-24 (auditoría externa, sobreventa de capacidad confirmada): reserva atómica '
  'de cupo en capacity_slots (SELECT ... FOR UPDATE + verificación + incremento en una sola '
  'transacción). Reemplaza el patrón check-then-insert-then-optimistic-update usado antes en '
  'src/app/api/stripe/confirm/route.ts, que dejaba una ventana de carrera entre el chequeo de '
  'disponibilidad y el INSERT de la orden. Restringida a llamadas server-side '
  '(service_role/postgres/supabase_admin), mismo criterio que apply_wallet_delta (migración 233).';

-- ============================================================
-- release_capacity_slot: compensación best-effort si la orden NO llega a
-- crearse después de comprometer el cupo (ej. el INSERT en `orders` falla
-- por otra razón ya después de que commit_capacity_slot tuvo éxito). Sin
-- esto, un fallo posterior al commit dejaría el slot con cupo comprometido
-- "fantasma" sin ninguna orden real detrás -- el mismo tipo de
-- desalineación silenciosa que este fix busca eliminar, solo que en la
-- dirección opuesta (sub-venta en vez de sobreventa).
-- ============================================================
CREATE OR REPLACE FUNCTION release_capacity_slot(
  p_slot_id UUID,
  p_teams_to_release INTEGER DEFAULT 1
)
RETURNS TABLE (committed_teams INTEGER, max_teams INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_committed_teams INTEGER;
  v_max_teams INTEGER;
  v_new_committed INTEGER;
BEGIN
  -- auth.uid() lee el JWT de la sesión real (no current_user, que en
  -- SECURITY DEFINER devuelve el dueño de la función, no el caller).
  -- auth.uid() es NULL para llamadas service_role (sin sesión JWT).
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION
      'release_capacity_slot: solo llamadas server-side pueden liberar capacidad'
      USING ERRCODE = '42501';
  END IF;

  IF p_teams_to_release IS NULL OR p_teams_to_release <= 0 THEN
    RAISE EXCEPTION 'release_capacity_slot: p_teams_to_release debe ser un entero positivo (recibido %)', p_teams_to_release;
  END IF;

  SELECT committed_teams, max_teams
  INTO v_committed_teams, v_max_teams
  FROM capacity_slots
  WHERE id = p_slot_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'capacity_slots row % not found', p_slot_id;
  END IF;

  -- GREATEST(0, ...) evita que una liberación duplicada (ej. reintento del
  -- caller) empuje el contador por debajo de cero.
  v_new_committed := GREATEST(0, v_committed_teams - p_teams_to_release);

  UPDATE capacity_slots
  SET committed_teams = v_new_committed, updated_at = now()
  WHERE id = p_slot_id;

  RETURN QUERY SELECT v_new_committed, v_max_teams;
END;
$$;

COMMENT ON FUNCTION release_capacity_slot IS
  'Fix 2026-07-24 (auditoría externa): compensación atómica para commit_capacity_slot -- '
  'usada por confirm/route.ts cuando el cupo ya se comprometió pero el INSERT de la orden '
  'falla después, para no dejar cupo comprometido sin una orden real detrás.';

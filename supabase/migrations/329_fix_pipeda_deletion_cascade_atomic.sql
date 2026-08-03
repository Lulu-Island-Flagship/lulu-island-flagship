-- Migración 329 (pentest externo, hallazgo 3, 2026-08-02)
--
-- PATCH /api/admin/pipeda/requests/[id] (action=complete, request_type=deletion)
-- ejecutaba el cascade de soft-delete (client_profiles, profiles, orders,
-- quotes, communication_log, client_properties) con Promise.allSettled: 6
-- llamadas HTTP/Postgres INDEPENDIENTES desde el route handler, sin
-- transacción que las agrupara. La migración 306 (fix_pipeda_partial_failure_status)
-- ya arregló que el estado reportado fuera honesto (agrega el status
-- 'partial_failure' en vez de mentir 'completed' si algo falló), pero NO
-- arregló la causa raíz: si, por ejemplo, `orders` fallaba después de que
-- `client_profiles`/`profiles` ya se hubieran actualizado con éxito, esas
-- dos tablas quedaban con `deleted_at` escrito PERMANENTEMENTE aunque el
-- resto del cascade nunca se completara -- estado a medias real en la base,
-- no solo un status mal reportado. Un reintento manual del mismo action
-- 'complete' volvía a intentar TODO el cascade desde cero (sin idempotencia
-- por tabla), así que ni siquiera un reintento simple resolvía la
-- inconsistencia de forma segura.
--
-- Fix: se mueve el cascade completo a una única función SECURITY DEFINER
-- (pipeda_execute_deletion_cascade), invocada como una sola llamada RPC. El
-- cascade de UPDATEs corre dentro de un bloque BEGIN/EXCEPTION de PL/pgSQL:
-- si CUALQUIER UPDATE falla, ese bloque se revierte completo (savepoint
-- implícito) -- ninguna tabla queda parcialmente actualizada -- y la función
-- deja la solicitud en 'partial_failure' con el detalle del error en
-- `deletion_errors` (mismo status introducido en 306, ahora respaldado por
-- un cascade real y atómico en vez de uno de mejor esfuerzo). Si todo el
-- cascade tiene éxito, la misma función marca 'completed' con
-- `purge_eligible_at`. route.ts ya no arma el UPDATE final a
-- data_subject_requests para request_type='deletion' -- solo llama al RPC y
-- devuelve su resultado.

CREATE OR REPLACE FUNCTION pipeda_execute_deletion_cascade(
  p_request_id UUID,
  p_admin_user_id UUID
)
RETURNS data_subject_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request data_subject_requests%ROWTYPE;
  v_client_profile_id UUID;
  v_now TIMESTAMPTZ := now();
  v_purge_eligible_at TIMESTAMPTZ;
  v_error_detail TEXT;
BEGIN
  -- Defensa en profundidad (mismo patrón que resolve_ticket_atomic/320):
  -- el caller esperado es el service-role client de route.ts (que ya pasó
  -- por requireAdminRole('compliance') antes de llegar aquí), pero si este
  -- RPC se invocara directo con una sesión normal, exige al menos un rol
  -- admin activo en vez de confiar ciegamente en el caller.
  -- auth.uid() lee el JWT de la sesión real (no current_user, que en
  -- SECURITY DEFINER devuelve el dueño de la función, no el caller).
  -- auth.uid() es NULL para llamadas service_role (sin sesión JWT).
  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM admin_roles WHERE user_id = auth.uid() AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'pipeda_execute_deletion_cascade: no autorizado -- se requiere un rol administrativo activo'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT * INTO v_request
  FROM data_subject_requests
  WHERE id = p_request_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PIPEDA_REQUEST_NOT_FOUND';
  END IF;

  IF v_request.status IN ('completed', 'denied') THEN
    RAISE EXCEPTION 'PIPEDA_REQUEST_ALREADY_FINALIZED';
  END IF;

  IF v_request.request_type <> 'deletion' THEN
    RAISE EXCEPTION 'PIPEDA_REQUEST_NOT_DELETION';
  END IF;

  -- Retención fiscal de 2 años (E9.9/E9.12), mismo criterio que
  -- computePurgeEligibleAt() en src/lib/pipeda.ts.
  v_purge_eligible_at := v_now + (INTERVAL '1 year' * 2);

  SELECT id INTO v_client_profile_id
  FROM client_profiles
  WHERE user_id = v_request.client_user_id;

  BEGIN
    UPDATE client_profiles
      SET deleted_at = v_now
      WHERE user_id = v_request.client_user_id;

    UPDATE profiles
      SET deleted_at = v_now
      WHERE id = v_request.client_user_id;

    UPDATE orders
      SET deleted_at = v_now
      WHERE user_id = v_request.client_user_id AND deleted_at IS NULL;

    UPDATE quotes
      SET deleted_at = v_now
      WHERE user_id = v_request.client_user_id AND deleted_at IS NULL;

    UPDATE communication_log
      SET deleted_at = v_now
      WHERE user_id = v_request.client_user_id AND deleted_at IS NULL;

    IF v_client_profile_id IS NOT NULL THEN
      UPDATE client_properties
        SET deleted_at = v_now
        WHERE client_profile_id = v_client_profile_id AND deleted_at IS NULL;
    END IF;

    UPDATE data_subject_requests
      SET status = 'completed',
          processed_by_admin = p_admin_user_id,
          completed_at = v_now,
          purge_eligible_at = v_purge_eligible_at,
          deletion_errors = NULL
      WHERE id = p_request_id
      RETURNING * INTO v_request;

  EXCEPTION WHEN OTHERS THEN
    -- Revierte SOLO este bloque (savepoint implícito de BEGIN/EXCEPTION) --
    -- ninguna de las tablas de arriba queda con deleted_at escrito a
    -- medias. El UPDATE de abajo corre FUERA del bloque revertido, sobre la
    -- misma fila que ya está bloqueada por el FOR UPDATE de arriba (el lock
    -- no se libera por el rollback del savepoint), así que queda rastro de
    -- auditoría del intento fallido sin dejar ninguna tabla PII a medio
    -- borrar.
    v_error_detail := SQLERRM;
    UPDATE data_subject_requests
      SET status = 'partial_failure',
          deletion_errors = '[329] Cascade de borrado abortado atómicamente antes de escribir ninguna tabla: ' || v_error_detail
      WHERE id = p_request_id
      RETURNING * INTO v_request;

    RETURN v_request;
  END;

  RETURN v_request;
END;
$$;

REVOKE EXECUTE ON FUNCTION pipeda_execute_deletion_cascade(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION pipeda_execute_deletion_cascade(UUID, UUID) TO authenticated, service_role;

COMMENT ON FUNCTION pipeda_execute_deletion_cascade IS
  'Fix pentest hallazgo 3 (2026-08-02): reemplaza el cascade de soft-delete PIPEDA (client_profiles/profiles/orders/quotes/communication_log/client_properties) hecho con Promise.allSettled en 6 llamadas Postgres independientes por un único RPC SECURITY DEFINER cuyo cascade corre en un bloque BEGIN/EXCEPTION -- si cualquier UPDATE falla, TODO el cascade se revierte (nunca queda una tabla con deleted_at a medio escribir) y la solicitud queda en partial_failure con el detalle del error; si todo tiene éxito, marca completed + purge_eligible_at en la misma operación atómica.';

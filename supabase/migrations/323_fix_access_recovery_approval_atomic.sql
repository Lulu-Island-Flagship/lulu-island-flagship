-- Migración 323 (pentest externo "Kimi", hallazgo 4, 2026-08-02)
--
-- Dos vías distintas pueden aprobar la misma access_recovery_requests y
-- emitir el código de acceso de emergencia:
--   A) POST /api/admin/access-recovery { action: "approve" } -- un
--      owner_admin ya autenticado.
--   B) POST /api/recovery/co-verify { action: "confirm" } -- un SEGUNDO
--      trusted_successor que confirma con su propio código.
--
-- Ambas rutas hacían lo mismo: leer access_recovery_requests.status, chequear
-- en JS que fuera 'verified_pending_approval', llamar a
-- issueEmergencyAccessCodes() (que genera códigos en texto plano e inserta
-- sus hashes en owner_admin_backup_codes), y SOLO DESPUÉS escribir
-- status='approved' -- tres pasos, sin ninguna transacción ni lock que los
-- agrupara, y ADEMÁS repartidos entre DOS endpoints HTTP independientes que
-- ni siquiera comparten código.
--
-- Un admin aprobando desde el panel casi al mismo tiempo que un segundo
-- successor confirma su código de co-verificación (ambos legítimos, cada
-- uno pensando que es el único que está aprobando) podían pasar AMBOS el
-- chequeo "status === 'verified_pending_approval'" antes de que cualquiera
-- de los dos escribiera el UPDATE final -- resultado: DOS juegos de códigos
-- de acceso de emergencia de un solo uso emitidos e insertados en
-- owner_admin_backup_codes para la MISMA solicitud, cada uno enviado a un
-- destinatario distinto (el admin ve el suyo en la respuesta HTTP, el
-- successor original recibe el suyo por SMS/email). Ambos códigos son
-- válidos: se duplica la superficie de acceso de emergencia sin que nadie
-- se entere, justo en el flujo más sensible del sistema (bypass de MFA del
-- dueño).
--
-- Fix (mismo patrón CAS que 320/321/322): una única función SECURITY
-- DEFINER que hace el UPDATE de la TRANSICIÓN DE ESTADO con
-- `WHERE status = 'verified_pending_approval'` -- compare-and-swap atómico
-- a nivel de fila de Postgres. Solo UNA de las dos rutas (admin approve /
-- successor confirm) puede ganar la carrera del UPDATE; la que pierde ve 0
-- filas afectadas y NUNCA llega a llamar a issueEmergencyAccessCodes(). La
-- generación de los códigos en sí sigue en TypeScript (necesita devolver el
-- texto plano al llamador y usar el generador/hasher existentes de
-- backup-codes -- no se reimplementa esa lógica en SQL), pero ahora solo se
-- ejecuta DESPUÉS de haber ganado limpiamente el CAS de esta función, nunca
-- antes.

CREATE OR REPLACE FUNCTION claim_access_recovery_approval_atomic(
  p_request_id UUID,
  p_resolved_by TEXT,
  p_resolved_by_admin_user_id UUID,
  p_resolved_by_successor_id UUID
)
RETURNS SETOF access_recovery_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row access_recovery_requests%ROWTYPE;
BEGIN
  -- access_recovery_requests tiene RLS "false/false" (203_...): solo
  -- service_role la toca, desde getServiceRoleClient() en ambas rutas
  -- (admin/access-recovery y recovery/co-verify). El GRANT de abajo ya
  -- restringe EXECUTE a service_role -- este chequeo es defensa en
  -- profundidad, mismo patrón que 304/305/320/321/322, por si alguna vez se
  -- amplía el GRANT.
  -- auth.uid() lee el JWT de la sesión real (no current_user, que en
  -- SECURITY DEFINER devuelve el dueño de la función, no el caller).
  -- auth.uid() es NULL para llamadas service_role (sin sesión JWT).
  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM admin_roles WHERE user_id = auth.uid() AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'claim_access_recovery_approval_atomic: no autorizado'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_resolved_by IS NULL OR length(trim(p_resolved_by)) = 0 THEN
    RAISE EXCEPTION 'p_resolved_by is required';
  END IF;

  -- CAS atómico: solo afecta una fila si la solicitud sigue en
  -- 'verified_pending_approval'. Si la otra vía (admin approve / successor
  -- confirm) ya la reclamó, esta UPDATE afecta 0 filas y NOT FOUND queda
  -- true abajo -- el llamador NUNCA emite un segundo juego de códigos de
  -- emergencia.
  UPDATE access_recovery_requests
  SET status = 'approved',
      resolved_at = now(),
      resolved_by = p_resolved_by,
      resolved_by_admin_user_id = p_resolved_by_admin_user_id,
      resolved_by_successor_id = p_resolved_by_successor_id,
      emergency_code_issued_at = now()
  WHERE id = p_request_id
    AND status = 'verified_pending_approval'
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    -- Distingue "no existe" de "ya estaba resuelta" para que cada route.ts
    -- pueda devolver el mismo código/mensaje de error que ya devolvía antes.
    IF EXISTS (SELECT 1 FROM access_recovery_requests WHERE id = p_request_id) THEN
      RAISE EXCEPTION 'REQUEST_ALREADY_RESOLVED';
    ELSE
      RAISE EXCEPTION 'REQUEST_NOT_FOUND';
    END IF;
  END IF;

  RETURN NEXT v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION claim_access_recovery_approval_atomic(UUID, TEXT, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_access_recovery_approval_atomic(UUID, TEXT, UUID, UUID) TO service_role;

COMMENT ON FUNCTION claim_access_recovery_approval_atomic IS
  'Fix pentest Kimi hallazgo 4 (2026-08-02): CAS atómico (UPDATE ... WHERE status = ''verified_pending_approval'') que sincroniza las dos vías de aprobación de access_recovery_requests -- POST /api/admin/access-recovery (action=approve) y POST /api/recovery/co-verify (action=confirm). Ambas rutas deben llamar a esta función y solo proceder a issueEmergencyAccessCodes() si devuelve una fila; de lo contrario la otra vía ya ganó la carrera y no se debe emitir un segundo juego de códigos de emergencia. Solo GRANT a service_role: ambos endpoints ya operan exclusivamente vía getServiceRoleClient() (la tabla tiene RLS false/false).';

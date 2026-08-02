-- Migración 321 (pentest externo "Kimi", hallazgo 2, 2026-08-02)
--
-- POST /api/admin/tickets/[id]/resolve leía tickets_disputas.status,
-- chequeaba en JS que estuviera en ('open', 'in_review'), y solo DESPUÉS
-- hacía un UPDATE aparte para marcarlo resuelto/escalado -- dos llamadas
-- HTTP separadas al mismo Postgres, sin transacción ni lock que las
-- agrupara (mismo patrón de bug que el fix 320 de route_shortcuts, y que
-- 305/307/304 antes de eso).
--
-- Dos requests POST concurrentes sobre el mismo tickets_disputas.id (ej. dos
-- supervisores resolviendo el mismo ticket casi a la vez, o doble clic)
-- podían pasar AMBOS el chequeo "if (!['open','in_review'].includes(status))"
-- antes de que cualquiera de los dos llegara a escribir el UPDATE -- la
-- lectura de ambos ocurre contra el mismo estado porque ninguno todavía
-- escribió nada. Resultado: el segundo UPDATE simplemente pisa
-- resolution_note/resolved_by/resolved_at/status del primero sin error, así
-- que un ticket ya resuelto por un supervisor con una nota puede terminar
-- con la nota (y hasta el status: resolved vs escalated) de otro supervisor
-- que llegó una fracción de segundo después -- se pierde silenciosamente la
-- primera resolución.
--
-- Fix (mismo patrón que validate_route_shortcut_atomic/320): una única
-- función SECURITY DEFINER que hace el UPDATE con
-- `WHERE status IN ('open', 'in_review')` -- un CAS (compare-and-swap)
-- atómico a nivel de fila de Postgres: SOLO UNA de las dos transacciones
-- concurrentes puede ganar la carrera del UPDATE (la segunda ve 0 filas
-- afectadas porque Postgres serializa las escrituras sobre la misma fila).
-- El route.ts solo dispara la comunicación al cliente (dispute_resolved) y
-- devuelve 200 si el RPC efectivamente afectó una fila; si no, devuelve 409
-- igual que antes.

CREATE OR REPLACE FUNCTION resolve_ticket_atomic(
  p_ticket_id UUID,
  p_status TEXT,
  p_resolution_note TEXT,
  p_resolver_employee_id UUID
)
RETURNS SETOF tickets_disputas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket tickets_disputas%ROWTYPE;
BEGIN
  -- Fix (auditoría de seguridad, mismo patrón que 304/305/320): sin este
  -- chequeo, cualquier usuario autenticado podría invocar este RPC directo
  -- y resolver/escalar cualquier ticket, saltándose requireAdminRole('tickets')
  -- del route.ts.
  IF current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    IF NOT EXISTS (
      SELECT 1 FROM admin_roles WHERE user_id = auth.uid() AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'resolve_ticket_atomic: no autorizado -- se requiere un rol administrativo activo'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_status NOT IN ('resolved', 'escalated') THEN
    RAISE EXCEPTION 'p_status must be resolved or escalated';
  END IF;

  IF p_resolution_note IS NULL OR length(trim(p_resolution_note)) = 0 THEN
    RAISE EXCEPTION 'p_resolution_note is required';
  END IF;

  -- CAS atómico: solo afecta una fila si el ticket sigue abierto/en revisión.
  -- Si otra transacción concurrente ya lo resolvió (ganó la carrera), esta
  -- UPDATE afecta 0 filas y NOT FOUND queda true abajo -- ninguna resolución
  -- se pisa silenciosamente.
  UPDATE tickets_disputas
  SET status = p_status,
      resolution_note = p_resolution_note,
      resolved_by = p_resolver_employee_id,
      resolved_at = now()
  WHERE id = p_ticket_id
    AND status IN ('open', 'in_review')
  RETURNING * INTO v_ticket;

  IF NOT FOUND THEN
    -- Distingue "no existe" de "ya estaba resuelto/escalado" para que el
    -- route.ts pueda devolver 404 vs 409 igual que antes.
    IF EXISTS (SELECT 1 FROM tickets_disputas WHERE id = p_ticket_id) THEN
      RAISE EXCEPTION 'TICKET_ALREADY_RESOLVED';
    ELSE
      RAISE EXCEPTION 'TICKET_NOT_FOUND';
    END IF;
  END IF;

  RETURN NEXT v_ticket;
END;
$$;

REVOKE EXECUTE ON FUNCTION resolve_ticket_atomic(UUID, TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION resolve_ticket_atomic(UUID, TEXT, TEXT, UUID) TO authenticated, service_role;

COMMENT ON FUNCTION resolve_ticket_atomic IS
  'Fix pentest Kimi hallazgo 2 (2026-08-02): reemplaza el read-then-write de POST /api/admin/tickets/[id]/resolve (leer status, chequear en JS que sea open/in_review, luego UPDATE en una llamada separada) por un CAS atómico (UPDATE ... WHERE status IN (''open'',''in_review'')). Cierra la ventana donde dos POST concurrentes sobre el mismo ticket pisaban silenciosamente la resolución (nota, resolved_by, status) del primero.';

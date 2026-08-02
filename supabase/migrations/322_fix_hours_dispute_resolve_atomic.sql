-- Migración 322 (pentest externo "Kimi", hallazgo 3, 2026-08-02)
--
-- POST /api/admin/hours-disputes/[id]/resolve leía tickets_disputas.status,
-- chequeaba en JS que estuviera en ('open', 'in_review'), luego -- TODAVÍA
-- sin haber marcado nada como resuelto -- escribía/insertaba en
-- service_logs (la corrección de horas que afecta nómina, ver FIX-9 arriba
-- en este mismo archivo), y solo DESPUÉS de eso hacía el UPDATE final de
-- tickets_disputas a 'resolved'. Tres llamadas HTTP separadas al mismo
-- Postgres, sin transacción ni lock que las agrupara.
--
-- Dos requests POST concurrentes sobre la misma disputa (doble clic de un
-- admin de nómina, o dos admins resolviendo la misma disputa casi a la vez)
-- podían pasar AMBOS el chequeo "if (!['open','in_review'].includes(status))"
-- porque ninguno de los dos todavía escribió nada -- y ambos procedían a
-- tocar service_logs. Esto es más grave que el caso de tickets genéricos
-- (migración 321) porque service_logs alimenta el cálculo de horas para
-- disputas y auditoría de nómina: dos correcciones aplicadas sobre el mismo
-- registro (ej. dos INSERT creando dos filas t_out cuando el log no
-- existía, o dos UPDATE con timestamps distintos pisándose) puede dejar
-- service_logs con datos duplicados o inconsistentes que un humano de
-- nómina tendría que destrabar a mano, y el ticket terminaba con el
-- resolution_note/resolved_by de quien ganara la carrera del UPDATE final,
-- perdiendo silenciosamente la resolución del otro.
--
-- Fix (mismo patrón que resolve_ticket_atomic/321 y
-- validate_route_shortcut_atomic/320): una única función SECURITY DEFINER
-- que hace SELECT ... FOR UPDATE (lock de fila) sobre el ticket, valida tipo
-- y estado, aplica la corrección de service_logs, marca el ticket resuelto,
-- y publica la alerta de nómina (best-effort, no bloqueante) -- todo dentro
-- de la MISMA transacción. El lock FOR UPDATE hace que una segunda llamada
-- concurrente espere a que la primera transacción termine (commit o
-- rollback) antes de leer la fila; cuando la lee, ve status='resolved' y
-- aborta con DISPUTE_ALREADY_RESOLVED -- ninguna segunda corrección de
-- service_logs llega a aplicarse.

CREATE OR REPLACE FUNCTION resolve_hours_dispute_atomic(
  p_ticket_id UUID,
  p_action TEXT,
  p_resolution_note TEXT,
  p_corrected_timestamp TIMESTAMPTZ,
  p_resolver_user_id UUID
)
RETURNS SETOF tickets_disputas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket tickets_disputas%ROWTYPE;
  v_ctx JSONB;
  v_claimed_event_type TEXT;
  v_existing_log_id UUID;
  v_resolution_note TEXT;
BEGIN
  -- Fix (auditoría de seguridad, mismo patrón que 304/305/320/321): sin este
  -- chequeo, cualquier usuario autenticado podría invocar este RPC directo
  -- y resolver disputas de horas / reescribir service_logs de nómina,
  -- saltándose requireAdminRole('tickets') del route.ts.
  IF current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    IF NOT EXISTS (
      SELECT 1 FROM admin_roles WHERE user_id = auth.uid() AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'resolve_hours_dispute_atomic: no autorizado -- se requiere un rol administrativo activo'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_action NOT IN ('approve_correction', 'reject') THEN
    RAISE EXCEPTION 'Invalid action. Use approve_correction or reject';
  END IF;

  -- Lock de la fila del ticket: una segunda llamada concurrente sobre el
  -- mismo ticket espera aquí hasta que esta transacción termine.
  SELECT * INTO v_ticket FROM tickets_disputas WHERE id = p_ticket_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DISPUTE_NOT_FOUND';
  END IF;

  IF v_ticket.type <> 'hours_dispute' THEN
    RAISE EXCEPTION 'NOT_HOURS_DISPUTE';
  END IF;

  IF v_ticket.status NOT IN ('open', 'in_review') THEN
    RAISE EXCEPTION 'DISPUTE_ALREADY_RESOLVED';
  END IF;

  v_ctx := COALESCE(v_ticket.context, '{}'::jsonb);
  v_claimed_event_type := v_ctx->>'claimed_event_type';

  -- --- Corrección de service_logs (D.3 #7: "falla técnica nunca penaliza") ---
  IF p_action = 'approve_correction' AND p_corrected_timestamp IS NOT NULL THEN
    IF v_claimed_event_type IS NULL THEN
      RAISE EXCEPTION 'MISSING_CLAIMED_EVENT_TYPE';
    END IF;

    SELECT id INTO v_existing_log_id
    FROM service_logs
    WHERE order_id = v_ticket.order_id
      AND employee_id = v_ticket.employee_id
      AND event_type = v_claimed_event_type
    ORDER BY timestamp DESC
    LIMIT 1;

    IF v_existing_log_id IS NOT NULL THEN
      UPDATE service_logs
      SET timestamp = p_corrected_timestamp,
          notes = 'Corrected via hours dispute ' || p_ticket_id || ' (admin ' || p_resolver_user_id || ')'
      WHERE id = v_existing_log_id;
    ELSE
      -- Falla técnica: el evento nunca se registró. Se crea ahora con el
      -- timestamp corregido para que la hora pagada refleje la realidad
      -- reclamada por el empleado, no un cero por ausencia de registro.
      INSERT INTO service_logs (order_id, employee_id, event_type, timestamp, notes)
      VALUES (
        v_ticket.order_id,
        v_ticket.employee_id,
        v_claimed_event_type,
        p_corrected_timestamp,
        'Created via hours dispute ' || p_ticket_id || ' (admin ' || p_resolver_user_id || ') -- technical failure, never penalize'
      );
    END IF;
  END IF;

  v_resolution_note := COALESCE(
    p_resolution_note,
    CASE WHEN p_action = 'approve_correction' THEN 'Hours corrected' ELSE 'Dispute rejected' END
  );

  -- --- Marcar el ticket resuelto (CAS implícito por el lock FOR UPDATE) ---
  UPDATE tickets_disputas
  SET status = 'resolved',
      resolved_by = p_resolver_user_id,
      resolved_at = now(),
      resolution_note = v_resolution_note
  WHERE id = p_ticket_id
  RETURNING * INTO v_ticket;

  -- --- Alerta a nómina (best-effort, no bloqueante -- mismo comportamiento
  -- que publishUnifiedAlert(), que nunca lanza si el insert falla) ---
  IF p_action = 'approve_correction' THEN
    BEGIN
      INSERT INTO unified_alerts (source_module, source_table, source_id, tier, severity, title, summary)
      VALUES (
        'hours_dispute_resolution',
        'tickets_disputas',
        p_ticket_id,
        'can_wait',
        'p1_urgent',
        'Disputa de horas resuelta a favor del empleado — revisar ajuste de nómina',
        'El ticket ' || p_ticket_id || ' (empleado ' || v_ticket.employee_id || ', orden ' || v_ticket.order_id || ') se resolvió corrigiendo service_logs. ' ||
        'El pago es por Day Rate, no por horas registradas: no hay ajuste automático de nómina. ' ||
        'Nómina debe revisar manualmente si corresponde compensación adicional.'
      );
    EXCEPTION WHEN OTHERS THEN
      -- No bloquea la resolución de la disputa, que ya se guardó arriba.
      NULL;
    END;
  END IF;

  RETURN NEXT v_ticket;
END;
$$;

REVOKE EXECUTE ON FUNCTION resolve_hours_dispute_atomic(UUID, TEXT, TEXT, TIMESTAMPTZ, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION resolve_hours_dispute_atomic(UUID, TEXT, TEXT, TIMESTAMPTZ, UUID) TO authenticated, service_role;

COMMENT ON FUNCTION resolve_hours_dispute_atomic IS
  'Fix pentest Kimi hallazgo 3 (2026-08-02): reemplaza el read-then-write de POST /api/admin/hours-disputes/[id]/resolve (leer status, chequear en JS, corregir service_logs, luego UPDATE del ticket -- tres llamadas separadas) por una función SECURITY DEFINER que hace SELECT...FOR UPDATE del ticket, valida tipo/estado, corrige service_logs, marca el ticket resuelto y publica la alerta de nómina, todo en una sola transacción. Cierra la ventana donde dos POST concurrentes podían aplicar la corrección de horas dos veces sobre service_logs (afecta nómina) antes de que cualquiera de los dos marcara el ticket como resuelto.';

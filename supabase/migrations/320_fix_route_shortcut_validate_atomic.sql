-- Migración 320 (pentest externo "Kimi", hallazgo 1, 2026-08-02)
--
-- PATCH /api/admin/route-shortcuts/[id]/validate leía route_shortcuts.validated_at,
-- chequeaba en JS que fuera NULL, hacía un UPDATE aparte para marcarlo
-- validado, y solo DESPUÉS insertaba el bono de +$10 en
-- employee_wellbeing_bonuses -- tres pasos, tres llamadas HTTP separadas al
-- mismo Postgres, sin ninguna transacción ni lock que los agrupara.
--
-- Dos requests PATCH concurrentes sobre el mismo route_shortcuts.id (ej.
-- doble clic de un supervisor, o dos supervisores validando el mismo atajo
-- casi a la vez) podían pasar AMBOS el chequeo "if (existing.validated_at)"
-- antes de que cualquiera de los dos llegara a escribir el UPDATE -- la
-- lectura de ambos ocurre contra el mismo estado (validated_at = NULL)
-- porque ninguno todavía escribió nada. Resultado: dos UPDATE aplicados (el
-- segundo simplemente pisa validated_by/validated_at del primero, sin error)
-- y DOS INSERT en employee_wellbeing_bonuses -- el empleado cobra el bono de
-- $10 dos veces por el mismo atajo.
--
-- Fix (mismo patrón que apply_wallet_credit_to_order/307 y
-- offboard_employee_atomic/305): una única función SECURITY DEFINER que hace
-- el UPDATE con `WHERE validated_at IS NULL` -- esto es un CAS
-- (compare-and-swap) atómico a nivel de fila de Postgres: SOLO UNA de las
-- dos transacciones concurrentes puede ganar la carrera del UPDATE (la
-- segunda ve 0 filas afectadas porque Postgres serializa las escrituras
-- sobre la misma fila). El INSERT del bono ocurre DENTRO de la misma
-- transacción, condicionado a que el UPDATE sí haya afectado una fila -- así
-- que es imposible que el bono se pague sin que la validación haya "ganado"
-- limpiamente, y viceversa.

CREATE OR REPLACE FUNCTION validate_route_shortcut_atomic(
  p_shortcut_id UUID,
  p_validator_user_id UUID,
  p_bonus_cents INTEGER
)
RETURNS TABLE (
  id UUID,
  description TEXT,
  uses_count INTEGER,
  reported_at TIMESTAMPTZ,
  validated_at TIMESTAMPTZ,
  bonus_awarded BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shortcut route_shortcuts%ROWTYPE;
  v_bonus_row_count INTEGER := 0;
BEGIN
  -- Fix (auditoría de seguridad, mismo patrón que migraciones 300/301/305
  -- 2026-08-01/02): sin este chequeo, cualquier usuario autenticado podría
  -- invocar este RPC directo y validar cualquier atajo, cobrando el bono sin
  -- pasar por requireAdminRole('wellbeing') del route.ts.
  -- auth.uid() lee el JWT de la sesión real (no current_user, que en
  -- SECURITY DEFINER devuelve el dueño de la función, no el caller).
  -- auth.uid() es NULL para llamadas service_role (sin sesión JWT).
  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM admin_roles WHERE user_id = auth.uid() AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'validate_route_shortcut_atomic: no autorizado -- se requiere un rol administrativo activo'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_bonus_cents IS NULL OR p_bonus_cents < 0 THEN
    RAISE EXCEPTION 'p_bonus_cents must be >= 0';
  END IF;

  -- CAS atómico: solo afecta una fila si sigue sin validar. Si otra
  -- transacción concurrente ya la validó (ganó la carrera), esta UPDATE
  -- afecta 0 filas y NOT FOUND queda true abajo -- ningún bono duplicado se
  -- llega a insertar.
  UPDATE route_shortcuts
  SET validated_at = now(), validated_by = p_validator_user_id
  WHERE route_shortcuts.id = p_shortcut_id
    AND route_shortcuts.deleted_at IS NULL
    AND route_shortcuts.validated_at IS NULL
  RETURNING * INTO v_shortcut;

  IF NOT FOUND THEN
    -- Distingue "no existe" de "ya estaba validado" para que el route.ts
    -- pueda devolver 404 vs 409 igual que antes.
    IF EXISTS (SELECT 1 FROM route_shortcuts WHERE route_shortcuts.id = p_shortcut_id AND route_shortcuts.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'SHORTCUT_ALREADY_VALIDATED';
    ELSE
      RAISE EXCEPTION 'SHORTCUT_NOT_FOUND';
    END IF;
  END IF;

  -- Bono de $10, dentro de la MISMA transacción que el CAS de arriba.
  -- employee_wellbeing_bonuses_unique_streak (migración 226) ya protege
  -- contra un doble insert idéntico (employee_id, source, credit_date) --
  -- se preserva el mismo comportamiento "best effort, no bloqueante" que
  -- tenía el route.ts original (ON CONFLICT DO NOTHING en vez de fallar toda
  -- la validación si, por la razón que sea, ya existe un bono de
  -- shortcut_validated ese mismo día calendario para este empleado).
  INSERT INTO employee_wellbeing_bonuses (employee_id, source, bonus_cents, credit_date, notes)
  VALUES (
    v_shortcut.employee_id,
    'shortcut_validated',
    p_bonus_cents,
    (v_shortcut.validated_at AT TIME ZONE 'UTC')::date,
    'Atajo de ruta validado: route_shortcuts ' || v_shortcut.id
  )
  ON CONFLICT (employee_id, source, credit_date) DO NOTHING;

  GET DIAGNOSTICS v_bonus_row_count = ROW_COUNT;

  RETURN QUERY SELECT
    v_shortcut.id,
    v_shortcut.description,
    v_shortcut.uses_count,
    v_shortcut.reported_at,
    v_shortcut.validated_at,
    (v_bonus_row_count > 0);
END;
$$;

REVOKE EXECUTE ON FUNCTION validate_route_shortcut_atomic(UUID, UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION validate_route_shortcut_atomic(UUID, UUID, INTEGER) TO authenticated, service_role;

COMMENT ON FUNCTION validate_route_shortcut_atomic IS
  'Fix pentest Kimi hallazgo 1 (2026-08-02): reemplaza el read-then-write de PATCH /api/admin/route-shortcuts/[id]/validate (leer validated_at, chequear en JS, UPDATE, luego INSERT del bono -- en llamadas separadas) por un CAS atómico (UPDATE ... WHERE validated_at IS NULL) seguido del INSERT del bono en la MISMA transacción. Cierra la ventana donde dos PATCH concurrentes pagaban el bono de $10 dos veces por el mismo atajo.';

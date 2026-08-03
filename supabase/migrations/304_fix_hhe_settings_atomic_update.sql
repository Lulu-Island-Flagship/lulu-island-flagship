-- Fix (auditoría de integridad de datos 2026-08-01, Agente 4): PATCH
-- /api/admin/hhe-settings hacía ~20 escrituras sueltas (4 tipos de servicio
-- × 5 rangos × [UPDATE cierre de vigencia + INSERT de fila nueva]) desde el
-- route.ts, cada una un round-trip HTTP/SQL independiente sin transacción
-- que las envuelva. Si la escritura #13 fallaba (timeout de red, conexión
-- caída, etc.), las 12 anteriores ya habían committeado: la tabla HHE queda
-- con algunas celdas ya actualizadas a los valores nuevos y otras todavía en
-- los valores viejos -- un estado mixto que ningún admin pidió y que
-- descuadra el pricing engine (algunas celdas cotizan con la tabla nueva,
-- otras con la vieja) sin ningún error visible que lo señale.
--
-- Fix: una función plpgsql (transacción implícita: o todo el bloque
-- committea, o ninguna escritura sobrevive si RAISE EXCEPTION aborta a
-- mitad) que recibe la tabla completa como JSONB y hace las 20 celdas
-- adentro. El route.ts pasa a una sola llamada RPC en vez de 20 llamadas
-- REST sueltas.

CREATE OR REPLACE FUNCTION admin_update_hhe_table(
  p_table JSONB, -- {"regular": [n0..n4], "deep": [...], "move_in_out": [...], "post_construction": [...]}
  p_reason TEXT,
  p_admin_id UUID,
  p_effective_date DATE DEFAULT CURRENT_DATE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_service_types TEXT[] := ARRAY['regular', 'deep', 'move_in_out', 'post_construction'];
  v_st TEXT;
  v_idx INT;
  v_value NUMERIC;
BEGIN
  -- Fix (auditoría de seguridad, mismo patrón que migración 300/301
  -- 2026-08-01): PostgREST expone todo RPC a `authenticated` salvo que se
  -- restrinja explícitamente -- sin este chequeo, cualquier usuario
  -- autenticado (no solo un admin) podría llamar
  -- supabase.rpc('admin_update_hhe_table', {...}) directo y reescribir el
  -- pricing engine completo, saltándose requireAdminRole('hhe_settings') del
  -- route.ts. Se exige una fila activa en admin_roles para quien invoca,
  -- salvo llamadas server-side de confianza.
  -- auth.uid() lee el JWT de la sesión real (no current_user, que en
  -- SECURITY DEFINER devuelve el dueño de la función, no el caller).
  -- auth.uid() es NULL para llamadas service_role (sin sesión JWT).
  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM admin_roles WHERE user_id = auth.uid() AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'admin_update_hhe_table: no autorizado -- se requiere un rol administrativo activo'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'reason is required';
  END IF;

  FOREACH v_st IN ARRAY v_service_types LOOP
    IF jsonb_typeof(p_table -> v_st) IS DISTINCT FROM 'array' OR jsonb_array_length(p_table -> v_st) != 5 THEN
      RAISE EXCEPTION 'HHE table for service_type % must be an array of 5 numbers', v_st;
    END IF;

    FOR v_idx IN 0..4 LOOP
      -- Misma validación de rango que isValidHHETable() en el route.ts
      -- (> 0 y <= 50) -- se revalida aquí a nivel DB para que la función sea
      -- segura de llamar aunque algún futuro caller se salte la validación
      -- del route.
      BEGIN
        v_value := (p_table -> v_st ->> v_idx)::NUMERIC;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Invalid HHE value for % range %: not a number', v_st, v_idx;
      END;

      IF v_value IS NULL OR v_value <= 0 OR v_value > 50 THEN
        RAISE EXCEPTION 'Invalid HHE value for % range %: % (must be > 0 and <= 50)', v_st, v_idx, v_value;
      END IF;

      -- Cierra la fila vigente previa (si existía)
      UPDATE hhe_settings
      SET effective_to = p_effective_date, updated_at = now()
      WHERE service_type = v_st
        AND range_index = v_idx
        AND effective_to IS NULL;

      -- Inserta la nueva fila vigente
      INSERT INTO hhe_settings (service_type, range_index, hhe_value, effective_from, reason, created_by)
      VALUES (v_st, v_idx, v_value, p_effective_date, trim(p_reason), p_admin_id)
      ON CONFLICT (service_type, range_index, effective_from) DO UPDATE
        SET hhe_value = EXCLUDED.hhe_value,
            reason = EXCLUDED.reason,
            created_by = EXCLUDED.created_by,
            updated_at = now();
    END LOOP;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_update_hhe_table(JSONB, TEXT, UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_update_hhe_table(JSONB, TEXT, UUID, DATE) TO authenticated, service_role;

COMMENT ON FUNCTION admin_update_hhe_table IS
  'Fix integridad de datos 2026-08-01: reemplaza las ~20 escrituras sueltas que hacía PATCH /api/admin/hhe-settings desde el cliente JS por una única transacción atómica. O se actualizan las 20 celdas, o ninguna (RAISE EXCEPTION revierte todo el bloque). Exige un admin_roles activo para llamadas no server-side.';

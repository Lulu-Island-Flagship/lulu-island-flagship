-- v8.3 E0 — Tercera auditoría (2026-07-11): mismo hueco que 126, pero en las
-- otras 11 funciones SECURITY DEFINER del repo que nunca fijaron
-- SET search_path. Dos de ellas (admin_update_config, soft_delete_rewrite)
-- además ejecutan SQL dinámico (EXECUTE format(...)) con identificadores de
-- tabla resueltos en tiempo de ejecución -- la combinación SECURITY DEFINER
-- + SQL dinámico + search_path sin fijar es la superficie de ataque más
-- seria de las encontradas hasta ahora: sin esto, alguien podría crear un
-- schema propio con una tabla/función del mismo nombre y, si su search_path
-- se evalúa antes que "public" en el contexto de la llamada, secuestrar a
-- qué objeto apunta el SQL dinámico -- corriendo con los privilegios del
-- dueño de la función (normalmente postgres).
--
-- CREATE OR REPLACE preserva toda la lógica original verbatim; el único
-- cambio es agregar SET search_path = public a cada una. No cambia ningún
-- comportamiento observable hoy.
--
-- admin_update_config: se recrea con la firma/lógica más reciente (la de
-- 074_e2_cash_reserve_exposure.sql, que es la que está activa hoy), no la
-- original de 042 -- para no revertir el whitelist que creció con el tiempo.

CREATE OR REPLACE FUNCTION admin_update_config(
  p_table TEXT,
  p_id UUID,
  p_changes JSONB,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allowed TEXT[] := ARRAY[
    'feature_flags','pricing_settings','payroll_settings',
    'chargeback_settings','hhe_settings','cash_exposure_settings'
  ];
  v_set_clause TEXT;
  v_result JSONB;
BEGIN
  IF NOT has_admin_role(auth.uid(), ARRAY['owner_admin']) THEN
    RAISE EXCEPTION 'Solo owner_admin puede cambiar configuración';
  END IF;
  IF NOT (p_table = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'Tabla % no está en la whitelist de configuración', p_table;
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'El motivo del cambio es obligatorio (mínimo 3 caracteres)';
  END IF;

  PERFORM set_config('app.change_reason', p_reason, true);
  PERFORM set_config('app.change_user', auth.uid()::text, true);

  SELECT string_agg(format('%I = ($1->>%L)::%s', key, key,
           (SELECT format_type(a.atttypid, a.atttypmod)
            FROM pg_attribute a
            WHERE a.attrelid = p_table::regclass AND a.attname = key)), ', ')
    INTO v_set_clause
  FROM jsonb_object_keys(p_changes) AS key;

  IF v_set_clause IS NULL THEN
    RAISE EXCEPTION 'Sin cambios';
  END IF;

  EXECUTE format('UPDATE %I SET %s WHERE id = $2 RETURNING to_jsonb(%I.*)', p_table, v_set_clause, p_table)
    INTO v_result USING p_changes, p_id;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Fila % no encontrada en %', p_id, p_table;
  END IF;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION admin_undo_config_snapshot(p_snapshot_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snap config_snapshots%ROWTYPE;
  v_result JSONB;
BEGIN
  IF NOT has_admin_role(auth.uid(), ARRAY['owner_admin']) THEN
    RAISE EXCEPTION 'Solo owner_admin puede deshacer configuración';
  END IF;

  SELECT * INTO v_snap FROM config_snapshots WHERE id = p_snapshot_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Snapshot % no existe', p_snapshot_id;
  END IF;
  IF v_snap.undone_at IS NOT NULL THEN
    RAISE EXCEPTION 'Snapshot % ya fue deshecho el %', p_snapshot_id, v_snap.undone_at;
  END IF;

  -- Restaurar valores anteriores (excluyendo id) vía el mismo camino auditado
  v_result := admin_update_config(
    v_snap.table_name,
    v_snap.row_id,
    v_snap.values_before - 'id',
    format('DESHACER snapshot %s (%s)', p_snapshot_id, v_snap.reason)
  );

  UPDATE config_snapshots
  SET undone_at = now(), undone_by = auth.uid()
  WHERE id = p_snapshot_id;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION snapshot_config_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reason TEXT;
  v_user UUID;
BEGIN
  v_reason := NULLIF(current_setting('app.change_reason', true), '');
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Cambio de configuración en % sin motivo. Use el RPC admin_update_config con reason obligatorio (v8.3 B.2.10).', TG_TABLE_NAME;
  END IF;
  v_user := NULLIF(current_setting('app.change_user', true), '')::uuid;

  INSERT INTO config_snapshots (table_name, row_id, values_before, values_after, reason, changed_by)
  VALUES (TG_TABLE_NAME, OLD.id, to_jsonb(OLD), to_jsonb(NEW), v_reason, v_user);

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION soft_delete_rewrite()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  EXECUTE format(
    'UPDATE %I.%I SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL',
    TG_TABLE_SCHEMA, TG_TABLE_NAME
  ) USING OLD.id;
  RETURN NULL; -- suprime el DELETE físico
END;
$$;

CREATE OR REPLACE FUNCTION dr_drill_integrity_check()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_result JSONB;
  v_orphan_orders INTEGER;
  v_orphan_payroll INTEGER;
  v_orphan_assignments INTEGER;
BEGIN
  IF NOT has_admin_role(auth.uid(), ARRAY['owner_admin']) THEN
    RAISE EXCEPTION 'Solo owner_admin puede correr el chequeo de integridad de disaster recovery';
  END IF;

  SELECT count(*) INTO v_orphan_orders
  FROM orders o
  WHERE NOT EXISTS (SELECT 1 FROM quotes q WHERE q.id = o.quote_id);

  SELECT count(*) INTO v_orphan_payroll
  FROM payroll_entries p
  WHERE NOT EXISTS (SELECT 1 FROM employees e WHERE e.id = p.employee_id);

  SELECT count(*) INTO v_orphan_assignments
  FROM assignments a
  WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = a.order_id);

  SELECT jsonb_build_object(
    'checked_at', now(),
    'row_counts', jsonb_build_object(
      'orders', (SELECT count(*) FROM orders),
      'quotes', (SELECT count(*) FROM quotes),
      'employees', (SELECT count(*) FROM employees WHERE deleted_at IS NULL),
      'payroll_entries', (SELECT count(*) FROM payroll_entries WHERE deleted_at IS NULL),
      'assignments', (SELECT count(*) FROM assignments),
      'config_snapshots', (SELECT count(*) FROM config_snapshots)
    ),
    'referential_integrity', jsonb_build_object(
      'orphan_orders_without_quote', v_orphan_orders,
      'orphan_payroll_without_employee', v_orphan_payroll,
      'orphan_assignments_without_order', v_orphan_assignments
    ),
    'passed', (v_orphan_orders = 0 AND v_orphan_payroll = 0 AND v_orphan_assignments = 0)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION generate_review_token(p_order_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token UUID;
BEGIN
  v_token := gen_random_uuid();

  UPDATE orders
  SET review_token = v_token,
      review_token_used_at = NULL
  WHERE id = p_order_id
    AND status = 'completed'
    AND review_token IS NULL;

  RETURN v_token;
END;
$$;

CREATE OR REPLACE FUNCTION trigger_generate_review_token_on_complete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status <> 'completed') THEN
    NEW.review_token := gen_random_uuid();
    NEW.review_token_used_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION increment_no_show_count(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE client_profiles
  SET no_show_count = no_show_count + 1,
      updated_at = now()
  WHERE user_id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION trigger_create_qc_review_on_complete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee_id UUID;
  v_trust_level TEXT;
  v_qc_status TEXT;
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status <> 'completed') THEN
    SELECT employee_id INTO v_employee_id
    FROM assignments
    WHERE order_id = NEW.id
    ORDER BY assigned_at DESC
    LIMIT 1;

    IF v_employee_id IS NULL THEN
      RETURN NEW;
    END IF;

    SELECT trust_level INTO v_trust_level
    FROM employees
    WHERE id = v_employee_id;

    IF v_trust_level = 'elite' THEN
      v_qc_status := 'auto';
    ELSE
      v_qc_status := 'pending';
    END IF;

    INSERT INTO qc_reviews (order_id, employee_id, status, sampling_reason)
    VALUES (NEW.id, v_employee_id, v_qc_status,
      CASE WHEN v_qc_status = 'auto' THEN 'Elite auto-approval' ELSE NULL END)
    ON CONFLICT (order_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION check_rate_limit(p_ip_address TEXT, p_max_requests INTEGER DEFAULT 3)
RETURNS TABLE(allowed BOOLEAN, remaining INTEGER, reset_at TIMESTAMP WITH TIME ZONE)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_start TIMESTAMP WITH TIME ZONE;
  v_window_end TIMESTAMP WITH TIME ZONE;
  v_count INTEGER;
BEGIN
  SELECT window_start, window_end, request_count
  INTO v_window_start, v_window_end, v_count
  FROM rate_limits
  WHERE ip_address = p_ip_address
  ORDER BY window_start DESC
  LIMIT 1;

  IF v_window_start IS NULL OR NOW() > v_window_end THEN
    v_window_start := NOW();
    v_window_end := NOW() + INTERVAL '24 hours';

    INSERT INTO rate_limits (ip_address, request_count, window_start, window_end)
    VALUES (p_ip_address, 1, v_window_start, v_window_end)
    ON CONFLICT (ip_address, window_start) DO UPDATE
      SET request_count = rate_limits.request_count + 1,
          updated_at = NOW()
    RETURNING request_count INTO v_count;

    IF v_count <= p_max_requests THEN
      RETURN QUERY SELECT TRUE, p_max_requests - v_count, v_window_end;
    ELSE
      RETURN QUERY SELECT FALSE, 0, v_window_end;
    END IF;

    RETURN;
  END IF;

  INSERT INTO rate_limits (ip_address, request_count, window_start, window_end)
  VALUES (p_ip_address, 1, v_window_start, v_window_end)
  ON CONFLICT (ip_address, window_start) DO UPDATE
    SET request_count = rate_limits.request_count + 1,
        updated_at = NOW()
  RETURNING request_count INTO v_count;

  IF v_count > p_max_requests THEN
    RETURN QUERY SELECT FALSE, 0, v_window_end;
  ELSE
    RETURN QUERY SELECT TRUE, p_max_requests - v_count, v_window_end;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION cleanup_expired_rate_limits()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM rate_limits WHERE window_end < NOW();
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

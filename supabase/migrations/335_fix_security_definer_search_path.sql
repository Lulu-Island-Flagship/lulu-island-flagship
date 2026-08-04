-- Fix: R3 [CRITICAL] Add SET search_path to SECURITY DEFINER functions
-- SECURITY DEFINER functions without an explicit search_path are vulnerable
-- to search-path hijacking. This migration recreates each affected function
-- with `SET search_path = public` (the project convention).
-- Function bodies are copied exactly from their source migrations.

-- ============================================================
-- 012_rate_limit_table.sql
-- ============================================================

CREATE OR REPLACE FUNCTION check_rate_limit(p_ip_address TEXT, p_max_requests INTEGER DEFAULT 3)
RETURNS TABLE(allowed BOOLEAN, remaining INTEGER, reset_at TIMESTAMP WITH TIME ZONE) AS $$
DECLARE
  v_window_start TIMESTAMP WITH TIME ZONE;
  v_window_end TIMESTAMP WITH TIME ZONE;
  v_count INTEGER;
BEGIN
  -- Buscar la fila más reciente para esta IP
  SELECT window_start, window_end, request_count
  INTO v_window_start, v_window_end, v_count
  FROM rate_limits
  WHERE ip_address = p_ip_address
  ORDER BY window_start DESC
  LIMIT 1;

  -- Si no existe fila, o la ventana más reciente ya expiró: crear NUEVA ventana
  IF v_window_start IS NULL OR NOW() > v_window_end THEN
    v_window_start := NOW();
    v_window_end := NOW() + INTERVAL '24 hours';

    -- INSERT atómico con ON CONFLICT (maneja race condition si otra request insertó)
    INSERT INTO rate_limits (ip_address, request_count, window_start, window_end)
    VALUES (p_ip_address, 1, v_window_start, v_window_end)
    ON CONFLICT (ip_address, window_start) DO UPDATE
      SET request_count = rate_limits.request_count + 1,
          updated_at = NOW()
    RETURNING request_count INTO v_count;

    -- Si el INSERT ON CONFLICT incrementó a 1, era nueva ventana -> permitir
    -- Si incrementó a >1, otra request ganó la carrera -> recalcular remaining
    IF v_count <= p_max_requests THEN
      RETURN QUERY SELECT TRUE, p_max_requests - v_count, v_window_end;
    ELSE
      RETURN QUERY SELECT FALSE, 0, v_window_end;
    END IF;

    RETURN;
  END IF;

  -- Ventana vigente existe: intentar incrementar atómicamente
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION cleanup_expired_rate_limits()
RETURNS INTEGER AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM rate_limits WHERE window_end < NOW();
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- 014_modulo8_review_token.sql
-- ============================================================

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

-- ============================================================
-- 016_modulo7_qc_auto_trigger.sql
-- ============================================================

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
  -- Solo actuar cuando el status cambia a 'completed'
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status <> 'completed') THEN
    -- Obtener el empleado asignado a esta orden
    SELECT employee_id INTO v_employee_id
    FROM assignments
    WHERE order_id = NEW.id
    ORDER BY assigned_at DESC
    LIMIT 1;

    -- Si no hay asignación, no crear qc_review
    IF v_employee_id IS NULL THEN
      RETURN NEW;
    END IF;

    -- Obtener trust_level del empleado
    SELECT trust_level INTO v_trust_level
    FROM employees
    WHERE id = v_employee_id;

    -- Determinar status de qc_review
    IF v_trust_level = 'elite' THEN
      v_qc_status := 'auto';
    ELSE
      v_qc_status := 'pending';
    END IF;

    -- Insertar qc_review (ignorar si ya existe por UNIQUE(order_id))
    INSERT INTO qc_reviews (order_id, employee_id, status, sampling_reason)
    VALUES (NEW.id, v_employee_id, v_qc_status,
      CASE WHEN v_qc_status = 'auto' THEN 'Elite auto-approval' ELSE NULL END)
    ON CONFLICT (order_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================
-- 039_e0_soft_delete_universal.sql
-- ============================================================

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

-- ============================================================
-- 042_e0_config_snapshots.sql
-- ============================================================

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

-- admin_update_config: combined whitelist from 042, 057, and 074.
-- Includes both communication_templates (057) and cash_exposure_settings (074).
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
    'chargeback_settings','hhe_settings','cash_exposure_settings',
    'communication_templates'
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

-- ============================================================
-- 057_e6_communication_templates_history.sql and
-- 074_e2_cash_reserve_exposure.sql
-- These both redefine admin_update_config with different whitelists.
-- The combined version above (with both communication_templates and
-- cash_exposure_settings) is the final authoritative version.
-- ============================================================

-- Note: apply_payroll_cycle_deduction_batch (332) is SECURITY INVOKER,
-- not SECURITY DEFINER, so it does not need SET search_path.

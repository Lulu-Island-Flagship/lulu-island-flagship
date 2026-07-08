-- ============================================================
-- E0 RETROFIT — Criterio 6: Snapshot/Undo GENÉRICO de configuración
-- (invariante B.2.10: todo cambio de parámetros genera snapshot inmutable
--  con motivo obligatorio y botón Deshacer)
-- Generaliza lo que 028 hizo solo para pricing: ahora cualquier tabla de
-- configuración registrada aquí queda cubierta automáticamente.
-- ============================================================

CREATE TABLE IF NOT EXISTS config_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name TEXT NOT NULL,
  row_id UUID NOT NULL,
  values_before JSONB NOT NULL,
  values_after JSONB NOT NULL,
  reason TEXT NOT NULL,
  changed_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  undone_at TIMESTAMPTZ,
  undone_by UUID
);

CREATE INDEX IF NOT EXISTS idx_config_snapshots_table ON config_snapshots(table_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_config_snapshots_row ON config_snapshots(row_id, created_at DESC);

-- Inmutable (registro histórico)
DROP TRIGGER IF EXISTS trg_prevent_delete ON config_snapshots;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON config_snapshots
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

ALTER TABLE config_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner reads config snapshots" ON config_snapshots
  FOR SELECT USING (has_admin_role(auth.uid(), ARRAY['owner_admin']));

-- ------------------------------------------------------------
-- Trigger genérico: captura before/after en cada UPDATE.
-- El motivo llega vía set_config LOCAL (lo pone el RPC de abajo).
-- Si no hay motivo => EXCEPCIÓN (motivo obligatorio, invariante B.2.10).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION snapshot_config_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
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

-- Tablas de configuración cubiertas (agregar aquí las futuras)
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'feature_flags','pricing_settings','payroll_settings',
    'chargeback_settings','hhe_settings'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_config_snapshot ON %I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_config_snapshot BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION snapshot_config_update()', t);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- RPC: actualizar configuración CON motivo (única vía soportada)
-- Solo owner_admin. Whitelist de tablas. Todo en una transacción.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_update_config(
  p_table TEXT,
  p_id UUID,
  p_changes JSONB,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_allowed TEXT[] := ARRAY['feature_flags','pricing_settings','payroll_settings','chargeback_settings','hhe_settings'];
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

  PERFORM set_config('app.change_reason', p_reason, true);  -- LOCAL a esta transacción
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

-- ------------------------------------------------------------
-- RPC: DESHACER un snapshot (restaura values_before)
-- El undo genera su propio snapshot (trazabilidad total, nunca se pierde nada).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_undo_config_snapshot(p_snapshot_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
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

COMMENT ON TABLE config_snapshots IS 'v8.3 E0-C6: snapshot inmutable de todo cambio de configuración, con motivo obligatorio y undo trazable';

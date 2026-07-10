-- ============================================================
-- E6 — Panel de edición de plantillas de comunicación (M13)
-- El catálogo de eventos y plantillas ya existe (migración 045).
-- Falta el panel admin para editar el TEXTO sin código, con historial
-- para revertir. En vez de construir un sistema de historial nuevo,
-- esta migración conecta communication_templates a la infraestructura
-- de snapshot/undo GENÉRICA que ya existe de E0 (config_snapshots,
-- admin_update_config / admin_undo_config_snapshot — migración 042).
--
-- Nota de diseño: communication_templates ya tiene su propio esquema de
-- versiones (version, is_current) pensado para llevar un historial
-- editorial completo por idioma. Esta migración NO reemplaza eso — lo
-- deja intacto para uso futuro — pero para "editar sin código +
-- deshacer" de HOY, el edito se hace vía UPDATE sobre la versión vigente
-- (is_current=true), igual que pricing_settings/feature_flags, y el
-- historial/deshacer sale gratis del trigger genérico de E0. Esto evita
-- construir un segundo sistema de historial en paralelo (instrucción
-- explícita de la tarea).
-- ============================================================

-- 1. Trigger de snapshot genérico (igual que en communication_events / 045)
DROP TRIGGER IF EXISTS trg_config_snapshot ON communication_templates;
CREATE TRIGGER trg_config_snapshot BEFORE UPDATE ON communication_templates
  FOR EACH ROW EXECUTE FUNCTION snapshot_config_update();

-- 2. Agregar communication_templates a la whitelist de admin_update_config.
-- Se re-crea la función completa (CREATE OR REPLACE) solo para ampliar el
-- arreglo v_allowed; el resto de la lógica es idéntica a la migración 042.
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
  v_allowed TEXT[] := ARRAY[
    'feature_flags','pricing_settings','payroll_settings',
    'chargeback_settings','hhe_settings','communication_templates'
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

COMMENT ON FUNCTION admin_update_config IS
  'v8.3 E0-C6 (ampliada en E6/057): RPC único y auditado para cambiar '
  'configuración con motivo obligatorio + snapshot. Whitelist: feature_flags, '
  'pricing_settings, payroll_settings, chargeback_settings, hhe_settings, '
  'communication_templates.';

-- v0.4.1 (flujo de contratación) -- historial inmutable de cambios sobre
-- system_settings (migración 251) + función RPC atómica para editarlos.
--
-- Por qué una tabla de historial separada y no un trigger genérico: se
-- quiere poder registrar `reason` (por qué se cambió el valor) y
-- `changed_by` explícitos en el mismo paso que el UPDATE, con garantía de
-- que ambos ocurren o ninguno (mismo problema que resolvió la migración
-- 249 para fixed_costs_settings: un update-then-insert en dos pasos puede
-- dejar el historial inconsistente si el segundo paso falla). Se sigue el
-- mismo patrón de función RPC SECURITY DEFINER atómica.
--
-- Por qué `set_system_setting` nunca crea keys nuevas implícitamente: las
-- keys de system_settings son parte del "contrato" que el código TS espera
-- (cada key tiene un value_type y un consumidor específico). Si un caller
-- pudiera crear keys arbitrarias vía este RPC, un typo silencioso
-- produciría una key fantasma que nadie lee ni valida -- en vez de un
-- error explícito. Las keys nuevas se agregan solo vía migración (ver
-- 253_hiring_flow_seed_system_settings.sql), nunca en runtime.

CREATE TABLE IF NOT EXISTS settings_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key TEXT NOT NULL REFERENCES system_settings(key) ON DELETE RESTRICT,
  old_value TEXT,
  new_value TEXT NOT NULL,
  changed_by UUID REFERENCES auth.users(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_settings_history_setting_key
  ON settings_history (setting_key, changed_at DESC);

ALTER TABLE settings_history ENABLE ROW LEVEL SECURITY;

-- Igual que system_settings: solo service role (vía API ya autorizada por
-- requireAdminRole()). El historial es de auditoría -- ni siquiera lectura
-- directa desde el cliente anon/authenticated.
DROP POLICY IF EXISTS "settings_history no direct access" ON settings_history;
CREATE POLICY "settings_history no direct access" ON settings_history
  FOR ALL USING (false) WITH CHECK (false);

COMMENT ON TABLE settings_history IS
  'v0.4.1 flujo de contratación: historial inmutable de cambios a '
  'system_settings, escrito exclusivamente por la función RPC atómica '
  'set_system_setting(). Solo accesible vía service role.';

-- Función RPC atómica: valida, registra el valor anterior en el historial,
-- y actualiza system_settings -- todo en una sola transacción. Si
-- cualquiera de los pasos falla (incluida la validación), no se aplica
-- ningún cambio parcial.
CREATE OR REPLACE FUNCTION set_system_setting(
  p_key TEXT,
  p_new_value TEXT,
  p_reason TEXT,
  p_changed_by UUID
)
RETURNS system_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current system_settings;
  v_result system_settings;
BEGIN
  -- system_settings es admin-only (mismo criterio que otras tablas de
  -- configuración financiera/operativa del repo). Se repite el chequeo de
  -- rol aquí porque esta función es SECURITY DEFINER y bypassea la RLS
  -- (que de por sí bloquea todo acceso directo) internamente.
  IF NOT has_admin_role(auth.uid(), ARRAY['owner_admin']) THEN
    RAISE EXCEPTION 'set_system_setting: solo owner_admin puede editar configuración del sistema'
      USING ERRCODE = '42501';
  END IF;

  IF p_key IS NULL OR length(trim(p_key)) = 0 THEN
    RAISE EXCEPTION 'set_system_setting: key es requerida'
      USING ERRCODE = '22023';
  END IF;
  IF p_new_value IS NULL THEN
    RAISE EXCEPTION 'set_system_setting: new_value es requerido (no puede ser NULL)'
      USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'set_system_setting: reason es requerido para el historial de auditoría'
      USING ERRCODE = '22023';
  END IF;

  -- Bloquea la fila para serializar ediciones concurrentes sobre la misma
  -- key (mismo patrón que set_current_fixed_costs, migración 249).
  SELECT * INTO v_current
  FROM system_settings
  WHERE key = p_key
  FOR UPDATE;

  -- Nunca crear keys nuevas implícitamente: si no existe, es un typo o un
  -- caller que no debería estar escribiendo esa key -- falla explícito en
  -- vez de crear una key fantasma sin value_type validado.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'set_system_setting: la key "%" no existe -- las keys nuevas se agregan solo por migración, nunca implícitamente', p_key
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO settings_history (setting_key, old_value, new_value, changed_by, reason)
  VALUES (p_key, v_current.value, p_new_value, p_changed_by, p_reason);

  UPDATE system_settings
  SET value = p_new_value,
      updated_at = now(),
      updated_by = p_changed_by
  WHERE key = p_key
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION set_system_setting IS
  'v0.4.1 flujo de contratación: actualiza system_settings de forma '
  'atómica -- valida que la key exista (nunca crea keys implícitamente), '
  'inserta en settings_history el valor anterior, y actualiza el valor '
  'nuevo, todo en una sola transacción.';

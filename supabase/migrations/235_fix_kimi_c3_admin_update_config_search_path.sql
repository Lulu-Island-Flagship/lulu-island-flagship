-- Fix Kimi-C3 (auditoría externa Kimi Code, 2026-07-21, verificado por Claude
-- antes de aplicar -- el reporte de Kimi citaba el archivo inexistente
-- "158_admin_update_config.sql"; el archivo real es
-- 158_e5_rebook_frictionless.sql, que SÍ recrea admin_update_config para
-- ampliar la whitelist con loyalty_settings).
--
-- Cronología real del bug (confirmada leyendo cada migración en orden):
--   042 (E0 fundación): crea admin_update_config, SIN SET search_path.
--   057 (E6 templates): CREATE OR REPLACE, amplía whitelist, SIGUE sin
--        SET search_path.
--   074 (E2 cash reserve): CREATE OR REPLACE, amplía whitelist otra vez,
--        SIGUE sin SET search_path.
--   127 (fix de search_path hijacking, tercera auditoría 2026-07-11):
--        CREATE OR REPLACE, POR FIN agrega SET search_path = public.
--   145 (autopilot flag): solo la MENCIONA en un comentario, no la toca.
--   158 (E5 rebook, la que Kimi mal-citó): CREATE OR REPLACE para agregar
--        'loyalty_settings' a la whitelist -- pero copió la firma de ANTES
--        del fix de 127 (sin SET search_path), así que corre DESPUÉS de 127
--        en la secuencia y BORRA silenciosamente la protección que 127 ya
--        había aplicado. Nadie lo notó porque CREATE OR REPLACE no avisa
--        qué se perdió.
--
-- Resultado: en la base de datos real (post-158), admin_update_config
-- quedaba SECURITY DEFINER + SQL dinámico (EXECUTE format(...)) + SIN
-- search_path fijo -- exactamente la combinación que 127 documentó como
-- "la superficie de ataque más seria" (alguien podría crear un schema
-- propio con una tabla/función del mismo nombre y secuestrar a qué objeto
-- apunta el SQL dinámico, corriendo con los privilegios del dueño de la
-- función).
--
-- Fix: CREATE OR REPLACE con la whitelist más reciente (incluye
-- loyalty_settings de 158) + SET search_path = public. Misma lógica
-- interna verbatim, ningún comportamiento observable cambia salvo cerrar
-- el hueco de search_path.
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
    'communication_templates','loyalty_settings'
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

COMMENT ON FUNCTION admin_update_config IS
  'v8.3 E0-C6 (042, ampliada en 057/074/158) + fix Kimi-C3 (migración 235, '
  '2026-07-21): RPC único y auditado para cambiar configuración con motivo '
  'obligatorio + snapshot. La migración 127 había agregado SET search_path '
  '= public, pero la migración 158 lo revirtió sin querer al recrear la '
  'función para ampliar la whitelist -- esta migración restaura el fix y '
  'consolida la whitelist vigente: feature_flags, pricing_settings, '
  'payroll_settings, chargeback_settings, hhe_settings, '
  'cash_exposure_settings, communication_templates, loyalty_settings.';

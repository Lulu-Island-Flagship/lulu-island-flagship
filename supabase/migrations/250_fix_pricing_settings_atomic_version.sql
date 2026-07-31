-- Fix (auditoría 2026-07-30, integridad financiera): PATCH
-- /api/admin/pricing-settings no era atómico -- mismo patrón de versionado
-- con el mismo bug que ya se corrigió para fixed_costs_settings (migración
-- 249, antes numerada 248, renumerada por colisión de número con
-- 248_fix_owner_admin_backup_codes_expiry.sql).
--
-- Secuencia anterior en route.ts (aprox líneas 86-117 antes de este fix):
--   1. SELECT id de la fila vigente (effective_to IS NULL).
--   2. UPDATE de esa fila: effective_to = ayer (la "cierra").
--   3. INSERT de la fila nueva con el valor vigente.
-- Si el paso 3 fallaba después de que el paso 2 ya se hubiera confirmado,
-- no quedaba NINGUNA fila vigente vigente para pricing_settings,
-- produciendo cotizaciones/margen calculados con la tarifa objetivo
-- fallback (70.0, ver GET en route.ts) en vez del valor real configurado,
-- de forma silenciosa hasta que alguien lo notara.
--
-- Fix: mismo patrón de función RPC atómica que set_current_fixed_costs
-- (migración 249) -- INSERT de la fila nueva y UPDATE de cierre de la
-- anterior dentro de una sola función Postgres/transacción. Si cualquiera
-- de los dos pasos falla, ambos se revierten: nunca queda una ventana con
-- cero filas vigentes ni con dos filas vigentes simultáneas.

CREATE OR REPLACE FUNCTION set_current_pricing_settings(
  p_target_hourly_rate NUMERIC,
  p_effective_from DATE,
  p_reason TEXT,
  p_created_by UUID
)
RETURNS TABLE (
  id UUID,
  target_hourly_rate NUMERIC,
  effective_from DATE,
  effective_to DATE,
  reason TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_previous_id UUID;
  v_new_id UUID;
BEGIN
  -- pricing_settings solo es editable por owner_admin (matriz RBAC en
  -- src/lib/admin-rbac.ts, resource 'pricing_settings' -> ['owner_admin']).
  -- Se repite la misma condición aquí porque la función es SECURITY
  -- DEFINER y bypassea RLS internamente.
  IF NOT has_admin_role(auth.uid(), ARRAY['owner_admin']) THEN
    RAISE EXCEPTION 'set_current_pricing_settings: solo owner_admin puede editar la tarifa objetivo'
      USING ERRCODE = '42501';
  END IF;

  IF p_target_hourly_rate IS NULL OR p_target_hourly_rate <= 0 THEN
    RAISE EXCEPTION 'set_current_pricing_settings: target_hourly_rate debe ser > 0'
      USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'set_current_pricing_settings: reason es requerido para el historial de auditoría'
      USING ERRCODE = '22023';
  END IF;
  IF p_effective_from IS NULL THEN
    RAISE EXCEPTION 'set_current_pricing_settings: effective_from es requerido'
      USING ERRCODE = '22023';
  END IF;

  -- Bloquea la fila vigente (si existe) para serializar ediciones
  -- concurrentes, mismo patrón que set_current_fixed_costs (migración 249).
  SELECT ps.id INTO v_previous_id
  FROM pricing_settings ps
  WHERE ps.effective_to IS NULL
  ORDER BY ps.effective_from DESC
  LIMIT 1
  FOR UPDATE;

  INSERT INTO pricing_settings (target_hourly_rate, effective_from, reason, created_by)
  VALUES (p_target_hourly_rate, p_effective_from, p_reason, p_created_by)
  RETURNING pricing_settings.id INTO v_new_id;

  IF v_previous_id IS NOT NULL THEN
    UPDATE pricing_settings
    SET effective_to = p_effective_from - INTERVAL '1 day',
        updated_at = now()
    WHERE pricing_settings.id = v_previous_id;
  END IF;

  RETURN QUERY
  SELECT ps.id, ps.target_hourly_rate, ps.effective_from, ps.effective_to,
         ps.reason, ps.created_by, ps.created_at, ps.updated_at
  FROM pricing_settings ps
  WHERE ps.id = v_new_id;
END;
$$;

COMMENT ON FUNCTION set_current_pricing_settings IS
  'Fix 2026-07-30 (auditoría de integridad financiera): versiona pricing_settings de forma '
  'atómica -- INSERT de la fila nueva vigente + UPDATE de cierre (effective_to) de la anterior '
  'dentro de una sola transacción. Reemplaza el update-then-insert en dos pasos separados de '
  'src/app/api/admin/pricing-settings/route.ts, que podía dejar la tabla sin ninguna fila '
  'vigente si el insert fallaba después de cerrar la fila anterior.';

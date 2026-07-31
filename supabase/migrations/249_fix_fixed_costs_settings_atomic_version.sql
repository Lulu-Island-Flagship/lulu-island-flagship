-- Fix (auditoría 2026-07-30, integridad financiera): PATCH
-- /api/admin/fixed-costs-settings no era atómico (mismo patrón de
-- versionado con el bug pendiente en /api/admin/pricing-settings, no
-- tocado por esta migración -- fuera de alcance de esta tarea).
--
-- Secuencia anterior en route.ts (aprox líneas 57-88 antes de este fix):
--   1. SELECT id de la fila vigente (effective_to IS NULL).
--   2. UPDATE de esa fila: effective_to = ayer (la "cierra").
--   3. INSERT de la fila nueva con el valor vigente.
-- Si el paso 3 fallaba después de que el paso 2 ya se hubiera confirmado,
-- no quedaba NINGUNA fila vigente -- get_current_monthly_fixed_costs_cents()
-- (migración 134) cae a su default de 0, produciendo un margen neto
-- silenciosamente optimista e incorrecto en todo el dashboard de
-- contabilidad hasta que alguien lo notara.
--
-- Fix: misma función RPC atómica que ya existe para flujos equivalentes
-- (commit_capacity_slot, migración 242; receive_purchase_order, migración
-- 247) -- INSERT de la fila nueva y UPDATE de cierre de la anterior dentro
-- de una sola función Postgres/transacción. Si cualquiera de los dos pasos
-- falla, ambos se revierten: nunca queda una ventana con cero filas
-- vigentes ni (a diferencia del fallback "insert primero" sugerido como
-- mínimo en la auditoría) una ventana con dos filas vigentes simultáneas.

CREATE OR REPLACE FUNCTION set_current_fixed_costs(
  p_monthly_fixed_costs_cents INTEGER,
  p_effective_from DATE,
  p_reason TEXT,
  p_created_by UUID
)
RETURNS TABLE (
  id UUID,
  monthly_fixed_costs_cents INTEGER,
  effective_from DATE,
  effective_to DATE,
  reason TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_previous_id UUID;
  v_new_id UUID;
BEGIN
  -- fixed_costs_settings solo es editable por owner_admin (migración 134,
  -- RLS: has_admin_role(auth.uid(), ARRAY['owner_admin'])). Se repite la
  -- misma condición aquí porque la función es SECURITY DEFINER y bypassea
  -- esa RLS internamente.
  IF NOT has_admin_role(auth.uid(), ARRAY['owner_admin']) THEN
    RAISE EXCEPTION 'set_current_fixed_costs: solo owner_admin puede editar costos fijos'
      USING ERRCODE = '42501';
  END IF;

  IF p_monthly_fixed_costs_cents IS NULL OR p_monthly_fixed_costs_cents < 0 THEN
    RAISE EXCEPTION 'set_current_fixed_costs: monthly_fixed_costs_cents debe ser >= 0'
      USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'set_current_fixed_costs: reason es requerido para el historial de auditoría'
      USING ERRCODE = '22023';
  END IF;
  IF p_effective_from IS NULL THEN
    RAISE EXCEPTION 'set_current_fixed_costs: effective_from es requerido'
      USING ERRCODE = '22023';
  END IF;

  -- Bloquea la fila vigente (si existe) para serializar ediciones
  -- concurrentes, mismo patrón que commit_capacity_slot/receive_purchase_order.
  SELECT fcs.id INTO v_previous_id
  FROM fixed_costs_settings fcs
  WHERE fcs.effective_to IS NULL
  ORDER BY fcs.effective_from DESC
  LIMIT 1
  FOR UPDATE;

  INSERT INTO fixed_costs_settings (monthly_fixed_costs_cents, effective_from, reason, created_by)
  VALUES (p_monthly_fixed_costs_cents, p_effective_from, p_reason, p_created_by)
  RETURNING fixed_costs_settings.id INTO v_new_id;

  IF v_previous_id IS NOT NULL THEN
    UPDATE fixed_costs_settings
    SET effective_to = p_effective_from - INTERVAL '1 day'
    WHERE fixed_costs_settings.id = v_previous_id;
  END IF;

  RETURN QUERY
  SELECT fcs.id, fcs.monthly_fixed_costs_cents, fcs.effective_from, fcs.effective_to,
         fcs.reason, fcs.created_by, fcs.created_at
  FROM fixed_costs_settings fcs
  WHERE fcs.id = v_new_id;
END;
$$;

COMMENT ON FUNCTION set_current_fixed_costs IS
  'Fix 2026-07-30 (auditoría de integridad financiera): versiona fixed_costs_settings de forma '
  'atómica -- INSERT de la fila nueva vigente + UPDATE de cierre (effective_to) de la anterior '
  'dentro de una sola transacción. Reemplaza el update-then-insert en dos pasos separados de '
  'src/app/api/admin/fixed-costs-settings/route.ts, que podía dejar la tabla sin ninguna fila '
  'vigente si el insert fallaba después de cerrar la fila anterior.';

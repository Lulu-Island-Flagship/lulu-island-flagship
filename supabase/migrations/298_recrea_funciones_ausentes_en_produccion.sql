-- [FIX 2026-08-01] Recrea tres funciones que el código llama a diario y que
-- NUNCA existieron en producción, pese a que sus migraciones (246, 247, 250)
-- figuran como aplicadas en `supabase_migrations.schema_migrations`.
--
-- POR QUÉ PASÓ:
-- En una sesión anterior se corrigió el historial de migraciones con
-- `supabase migration repair --status applied` para el rango 001-250 EN
-- BLOQUE, basándose en evidencia de que *algunos* objetos ya existían en la
-- base (los NOTICE de "already exists, skipping" durante un db push). Esa
-- marca declara "aplicada" pero no verifica objeto por objeto: cualquier
-- migración de ese rango que en realidad nunca corrió quedó marcada como si
-- sí lo hubiera hecho, y el CLI jamás volverá a intentarla.
--
-- CÓMO SE DESCUBRIÓ:
-- El 2026-07-31 el `db push` de la migración 295 falló con "could not find a
-- function named set_current_fixed_costs" (42883) -- esa función, de la
-- migración 249, nunca había existido en producción. Consecuencia real: cada
-- vez que el dueño intentaba guardar los costos fijos mensuales desde
-- /admin/contabilidad, la operación moría con un 500 silencioso. Se reparó
-- recreándola dentro de la propia 295.
--
-- Eso abrió la pregunta obvia: ¿cuántas más? El 2026-08-01 se corrió una
-- consulta contra `pg_proc` en producción comparando las 15 funciones más
-- críticas que el código TypeScript invoca vía `.rpc()`. Resultado: 12
-- existían, 3 NO. Esta migración recrea esas 3, con la definición idéntica a
-- la original de su migración de origen.
--
-- QUÉ ESTABA ROTO EN PRODUCCIÓN HASTA AHORA:
--
--   1. apply_payroll_cycle_deduction (origen: 246)
--      Llamada desde src/app/api/admin/payroll-export/route.ts. Sin ella, el
--      cierre del ciclo de nómina fallaba -- no se registraban las
--      deducciones de CPP/EI/WorkSafeBC ni se actualizaba el acumulado anual
--      (YTD) de ningún empleado.
--
--   2. receive_purchase_order (origen: 247)
--      Llamada desde src/app/api/admin/purchase-orders/[id]/approve/route.ts.
--      Sin ella, recibir mercancía de una orden de compra fallaba: el stock
--      de inventario nunca se reponía.
--
--   3. set_current_pricing_settings (origen: 250)
--      Llamada desde src/app/api/admin/pricing-settings/route.ts. Sin ella,
--      guardar un cambio en la tarifa objetivo por hora fallaba -- el precio
--      del negocio no se podía actualizar desde el panel.
--
-- Las tres se recrean con CREATE OR REPLACE (idempotente: seguro tanto si la
-- función falta como si ya existe), copiando la definición original sin
-- modificarla. No se cambia ninguna regla de negocio aquí -- esto es
-- estrictamente una reparación de despliegue.
--
-- NOTA PARA EL FUTURO: el rango 001-250 sigue sin estar verificado objeto por
-- objeto. Esta migración cubre las 3 funciones RPC confirmadas como
-- faltantes, pero podrían faltar también triggers, índices, vistas o
-- políticas RLS de ese mismo rango que la consulta a pg_proc no cubre (solo
-- mira funciones). Ver el informe AUDITORIA-Y-ARREGLOS-2026-08-01.md, §3.1.

-- ---------------------------------------------------------------------------
-- 1/3 — apply_payroll_cycle_deduction (definición original: migración 246)
-- ---------------------------------------------------------------------------
-- Agrupa el upsert de payroll_cycle_deductions y el upsert condicional de
-- payroll_ytd en una sola transacción. SECURITY INVOKER (default a propósito):
-- corre con los permisos RLS del admin autenticado que la invoca -- las
-- políticas "Supervisors manage cycle deductions"/"Supervisors manage payroll
-- ytd" (migración 052) ya lo autorizan, no hace falta elevar privilegios.
CREATE OR REPLACE FUNCTION apply_payroll_cycle_deduction(
  p_employee_id UUID,
  p_cycle_label TEXT,
  p_gross_cents INTEGER,
  p_cpp_cents INTEGER,
  p_cpp2_cents INTEGER,
  p_ei_employee_cents INTEGER,
  p_ei_employer_cents INTEGER,
  p_worksafebc_employer_cents INTEGER,
  p_vacation_pay_accrual_cents INTEGER,
  p_estimated_net_cents INTEGER,
  p_employer_cost_cents INTEGER,
  p_update_ytd BOOLEAN,
  p_calendar_year INTEGER,
  p_ytd_pensionable_cents INTEGER,
  p_ytd_insurable_cents INTEGER,
  p_ytd_assessable_cents INTEGER,
  p_ytd_cpp_contribution_cents INTEGER,
  p_ytd_cpp2_contribution_cents INTEGER,
  p_ytd_ei_employee_cents INTEGER,
  p_ytd_vacation_pay_accrued_cents INTEGER
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO payroll_cycle_deductions (
    employee_id, cycle_label, gross_cents, cpp_cents, cpp2_cents,
    ei_employee_cents, ei_employer_cents, worksafebc_employer_cents,
    vacation_pay_accrual_cents, estimated_net_cents, employer_cost_cents
  ) VALUES (
    p_employee_id, p_cycle_label, p_gross_cents, p_cpp_cents, p_cpp2_cents,
    p_ei_employee_cents, p_ei_employer_cents, p_worksafebc_employer_cents,
    p_vacation_pay_accrual_cents, p_estimated_net_cents, p_employer_cost_cents
  )
  ON CONFLICT (employee_id, cycle_label) DO UPDATE SET
    gross_cents = EXCLUDED.gross_cents,
    cpp_cents = EXCLUDED.cpp_cents,
    cpp2_cents = EXCLUDED.cpp2_cents,
    ei_employee_cents = EXCLUDED.ei_employee_cents,
    ei_employer_cents = EXCLUDED.ei_employer_cents,
    worksafebc_employer_cents = EXCLUDED.worksafebc_employer_cents,
    vacation_pay_accrual_cents = EXCLUDED.vacation_pay_accrual_cents,
    estimated_net_cents = EXCLUDED.estimated_net_cents,
    employer_cost_cents = EXCLUDED.employer_cost_cents;

  -- p_update_ytd = false cuando este ciclo ya se había procesado antes para
  -- este empleado (mismo criterio que alreadyProcessedThisCycle en route.ts)
  -- -- el cycle_deductions de arriba sigue siendo un upsert idempotente, pero
  -- el YTD no debe volver a sumarse.
  IF p_update_ytd THEN
    INSERT INTO payroll_ytd (
      employee_id, calendar_year, ytd_pensionable_cents, ytd_insurable_cents,
      ytd_assessable_cents, ytd_cpp_contribution_cents, ytd_cpp2_contribution_cents,
      ytd_ei_employee_cents, ytd_vacation_pay_accrued_cents, updated_at
    ) VALUES (
      p_employee_id, p_calendar_year, p_ytd_pensionable_cents, p_ytd_insurable_cents,
      p_ytd_assessable_cents, p_ytd_cpp_contribution_cents, p_ytd_cpp2_contribution_cents,
      p_ytd_ei_employee_cents, p_ytd_vacation_pay_accrued_cents, now()
    )
    ON CONFLICT (employee_id, calendar_year) DO UPDATE SET
      ytd_pensionable_cents = EXCLUDED.ytd_pensionable_cents,
      ytd_insurable_cents = EXCLUDED.ytd_insurable_cents,
      ytd_assessable_cents = EXCLUDED.ytd_assessable_cents,
      ytd_cpp_contribution_cents = EXCLUDED.ytd_cpp_contribution_cents,
      ytd_cpp2_contribution_cents = EXCLUDED.ytd_cpp2_contribution_cents,
      ytd_ei_employee_cents = EXCLUDED.ytd_ei_employee_cents,
      ytd_vacation_pay_accrued_cents = EXCLUDED.ytd_vacation_pay_accrued_cents,
      updated_at = now();
  END IF;
END;
$$;

COMMENT ON FUNCTION apply_payroll_cycle_deduction IS
  'Fix (auditoría externa, atomicidad de payroll-export): agrupa el upsert de payroll_cycle_deductions '
  'y el upsert condicional de payroll_ytd en una sola transacción. SECURITY INVOKER (default): corre '
  'con los permisos RLS del admin autenticado que la invoca. [FIX 2026-08-01] Recreada aquí: la '
  'migración 246 figuraba como aplicada pero esta función nunca existió en producción, así que el '
  'cierre del ciclo de nómina venía fallando en silencio.';

GRANT EXECUTE ON FUNCTION apply_payroll_cycle_deduction TO authenticated;

-- ---------------------------------------------------------------------------
-- 2/3 — receive_purchase_order (definición original: migración 247)
-- ---------------------------------------------------------------------------
-- Recepción atómica de una orden de compra: repone el stock de cada línea con
-- SQL atómico y solo entonces marca la PO como recibida. Si cualquier línea
-- falla, todo se revierte. SECURITY DEFINER + guard is_supervisor porque el
-- endpoint la llama con el cliente de sesión del admin (no service role).
CREATE OR REPLACE FUNCTION receive_purchase_order(p_po_id UUID)
RETURNS TABLE (
  po_id UUID,
  status TEXT,
  received_at TIMESTAMPTZ,
  lines_updated INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
  v_deleted_at TIMESTAMPTZ;
  v_line RECORD;
  v_lines_updated INTEGER := 0;
  v_received_at TIMESTAMPTZ := now();
  v_rows_affected INTEGER;
BEGIN
  IF NOT is_supervisor(auth.uid()) THEN
    RAISE EXCEPTION 'receive_purchase_order: solo supervisores pueden recibir órdenes de compra'
      USING ERRCODE = '42501';
  END IF;

  -- Bloquea la fila de la PO hasta el COMMIT: serializa recepciones
  -- concurrentes de la misma orden y elimina la ventana de "lost update".
  SELECT po.status, po.deleted_at
  INTO v_status, v_deleted_at
  FROM purchase_orders po
  WHERE po.id = p_po_id
  FOR UPDATE;

  IF NOT FOUND OR v_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'purchase_orders row % not found' , p_po_id USING ERRCODE = 'P0002';
  END IF;

  IF v_status <> 'ordered' THEN
    RAISE EXCEPTION
      'receive_purchase_order: estado actual es ''%'', se requiere ''ordered''', v_status
      USING ERRCODE = 'P0001';
  END IF;

  -- Incremento atómico en SQL (no read-modify-write en la aplicación).
  FOR v_line IN
    SELECT inventory_item_id, quantity
    FROM purchase_order_lines
    WHERE purchase_order_id = p_po_id
      AND inventory_item_id IS NOT NULL
      AND quantity IS NOT NULL
  LOOP
    UPDATE inventory_items
    SET current_stock = current_stock + v_line.quantity
    WHERE id = v_line.inventory_item_id;

    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
    IF v_rows_affected = 0 THEN
      -- Línea apunta a un inventory_item que ya no existe: abortamos toda la
      -- transacción en vez de reponer solo parte del stock.
      RAISE EXCEPTION
        'receive_purchase_order: inventory_items % no encontrado (línea de PO %)',
        v_line.inventory_item_id, p_po_id
        USING ERRCODE = 'P0002';
    END IF;

    v_lines_updated := v_lines_updated + 1;
  END LOOP;

  -- Solo si TODAS las líneas se repusieron sin error se marca como recibida.
  UPDATE purchase_orders
  SET status = 'received', received_at = v_received_at
  WHERE id = p_po_id;

  RETURN QUERY SELECT p_po_id, 'received'::TEXT, v_received_at, v_lines_updated;
END;
$$;

COMMENT ON FUNCTION receive_purchase_order IS
  'Fix 2026-07-30 (auditoría de integridad financiera): recepción atómica de una PO -- repone '
  'inventory_items.current_stock con SQL atómico para cada línea y solo entonces mueve '
  'purchase_orders.status a ''received'', todo en la misma transacción. [FIX 2026-08-01] Recreada '
  'aquí: la migración 247 figuraba como aplicada pero esta función nunca existió en producción, así '
  'que recibir mercancía de una orden de compra venía fallando y el stock nunca se reponía.';

-- ---------------------------------------------------------------------------
-- 3/3 — set_current_pricing_settings (definición original: migración 250)
-- ---------------------------------------------------------------------------
-- Versiona pricing_settings de forma atómica: INSERT de la fila nueva vigente
-- + UPDATE de cierre (effective_to) de la anterior, en una sola transacción.
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
  -- src/lib/admin-rbac.ts). Se repite aquí porque la función es SECURITY
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

  -- Bloquea la fila vigente para serializar ediciones concurrentes.
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
  'Fix 2026-07-30 (auditoría de integridad financiera): versiona pricing_settings de forma atómica '
  '-- INSERT de la fila nueva vigente + UPDATE de cierre de la anterior en una sola transacción. '
  '[FIX 2026-08-01] Recreada aquí: la migración 250 figuraba como aplicada pero esta función nunca '
  'existió en producción, así que guardar un cambio de tarifa objetivo venía fallando.';

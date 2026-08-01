-- Migración 287 — Fix (auditoría externa, hallazgo confirmado): POST
-- /api/admin/dispatch (redespacho de una orden) hacía, desde la API route,
-- tres pasos SEPARADOS sin ningún lock:
--   1. SELECT de asignaciones activas para detectar 'in_progress'.
--   2. UPDATE (soft-delete) de todas las asignaciones activas de la orden.
--   3. INSERT de las nuevas asignaciones.
-- Si dos admins (o un admin y el publicador automático de las 5:30 PM,
-- migración 140) ejecutaban un redespacho para la MISMA orden casi al mismo
-- tiempo, ambos podían pasar el paso 1 antes de que el otro llegara al paso
-- 2/3 -- ambos soft-deletan lo que veían y ambos insertan su propio
-- conjunto de empleados, dejando la orden con DOS equipos "pending"
-- simultáneos en vez de uno solo (el modelo de "equipo limpio" documentado
-- en el comentario de cabecera de la ruta se rompía bajo concurrencia real).
--
-- Fix: se mueve la secuencia completa a una función Postgres atómica que usa
-- `SELECT ... FOR UPDATE` sobre las filas activas de la orden (mismo patrón
-- que set_current_fixed_costs, migración 249, y commit_capacity_slot,
-- migración 242) para serializar redespachos concurrentes de la misma
-- orden: el segundo que llegue espera a que el primero termine su
-- transacción y ve el estado ya actualizado, en vez de correr en paralelo
-- sobre una foto vieja.

CREATE OR REPLACE FUNCTION redispatch_order_atomic(
  p_order_id UUID,
  p_employee_ids UUID[],
  p_notes TEXT,
  p_locked_by UUID
)
RETURNS SETOF assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_in_progress_count INT;
BEGIN
  -- Mismo guard de autorización que ya protege la tabla assignments vía RLS
  -- ("Supervisors manage assignments" / is_supervisor -- owner_admin,
  -- ops_coordinator o supervisor de campo activo). Se repite aquí porque
  -- SECURITY DEFINER bypassea RLS internamente.
  IF NOT is_supervisor(auth.uid()) THEN
    RAISE EXCEPTION 'redispatch_order_atomic: no autorizado'
      USING ERRCODE = '42501';
  END IF;

  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'redispatch_order_atomic: p_order_id es requerido'
      USING ERRCODE = '22023';
  END IF;
  IF p_employee_ids IS NULL OR array_length(p_employee_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'redispatch_order_atomic: p_employee_ids no puede estar vacío'
      USING ERRCODE = '22023';
  END IF;

  -- Bloquea las filas activas de esta orden para serializar redespachos
  -- concurrentes de la MISMA orden (no afecta otras órdenes).
  PERFORM 1 FROM assignments
  WHERE order_id = p_order_id AND deleted_at IS NULL
  FOR UPDATE;

  -- Mismo guard que existía en la API route (A-9, auditoría 2026-07-21):
  -- no redespachar si ya hay una asignación 'in_progress' -- se re-evalúa
  -- DESPUÉS de tomar el lock para ver el estado más reciente, no una foto
  -- vieja tomada antes del lock.
  SELECT count(*) INTO v_in_progress_count
  FROM assignments
  WHERE order_id = p_order_id AND deleted_at IS NULL AND status = 'in_progress';

  IF v_in_progress_count > 0 THEN
    RAISE EXCEPTION 'redispatch_order_atomic: order % has an in_progress assignment, resolve or close it before reassigning', p_order_id
      USING ERRCODE = '55000';
  END IF;

  UPDATE assignments
  SET status = 'cancelled', deleted_at = now(), updated_at = now()
  WHERE order_id = p_order_id AND deleted_at IS NULL;

  RETURN QUERY
  INSERT INTO assignments (order_id, employee_id, status, notes, locked_by_admin, locked_by, locked_at)
  SELECT p_order_id, emp_id, 'pending', p_notes, true, p_locked_by, now()
  FROM unnest(p_employee_ids) AS emp_id
  RETURNING *;
END;
$$;

COMMENT ON FUNCTION redispatch_order_atomic IS
  'Fix (auditoría externa): reemplaza el select-check + update(soft-delete) + insert en 3 pasos '
  'separados de POST /api/admin/dispatch por una única función atómica con SELECT...FOR UPDATE '
  'sobre las asignaciones activas de la orden, serializando redespachos concurrentes de la misma '
  'orden (dos admins, o un admin y el publicador automático de las 5:30 PM).';

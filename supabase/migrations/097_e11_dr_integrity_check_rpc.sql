-- Migración 097 — v8.3 E11.3/E11.4: RPC de verificación de restauración.
--
-- Objetivo: dar a POST /api/admin/dr-drill una prueba VERIFICABLE, no una
-- casilla de "confié en que funcionó". Cuenta filas en las tablas críticas
-- del negocio (si el conteo es 0 en una tabla que debería tener datos, algo
-- salió mal en la restauración) y corre un chequeo de integridad referencial
-- simple (huérfanos: filas hijas que apuntan a un padre que no existe).
--
-- LIMITACIÓN HONESTA: esto verifica la salud de la base de datos ACTUAL a la
-- que está conectado el servidor — no ejecuta un restore real de un pg_dump
-- a un Postgres externo (ese paso es manual, fuera del alcance de una RPC
-- SQL, y se registra en disaster_recovery_drills igualmente pero con
-- verification_details anotado a mano). Cuando el admin SÍ restaura un
-- pg_dump en staging, puede apuntar temporalmente esta RPC a esa base y
-- correrla ahí para obtener el mismo chequeo automatizado.

CREATE OR REPLACE FUNCTION dr_drill_integrity_check()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
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

  -- Huérfanos: orders sin quote_id válido
  SELECT count(*) INTO v_orphan_orders
  FROM orders o
  WHERE NOT EXISTS (SELECT 1 FROM quotes q WHERE q.id = o.quote_id);

  -- Huérfanos: payroll_entries sin employee_id válido
  SELECT count(*) INTO v_orphan_payroll
  FROM payroll_entries p
  WHERE NOT EXISTS (SELECT 1 FROM employees e WHERE e.id = p.employee_id);

  -- Huérfanos: assignments sin order_id válido
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

COMMENT ON FUNCTION dr_drill_integrity_check() IS
  'v8.3 E11.4: conteo de filas en tablas críticas + chequeo de huérfanos referenciales, usado por POST /api/admin/dr-drill como verificación síncrona del estado de la base.';

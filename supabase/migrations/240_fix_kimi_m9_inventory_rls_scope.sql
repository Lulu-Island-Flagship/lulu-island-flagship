-- Fix Kimi-M9/B2 (auditoría externa Kimi Code, 2026-07-21, verificado y
-- confirmado real -- el nombre de archivo que citaba Kimi
-- "210_inventory_rls_fix.sql" no existe; las políticas reales están en
-- 048_e7_inventory_suppliers_po_keys_towels.sql).
--
-- "Employees read inventory items" y "Employees read equipment
-- reservations" usan USING (auth.uid() IS NOT NULL) -- eso permite a
-- CUALQUIER sesión autenticada, incluyendo clientes (comprador), leer
-- inventario interno y reservas de equipo. El nombre de la política y el
-- propósito evidente (datos operativos internos) indican que debía
-- restringirse a empleados reales, no a cualquier usuario logueado.
DROP POLICY IF EXISTS "Employees read inventory items" ON inventory_items;
CREATE POLICY "Employees read inventory items" ON inventory_items
  FOR SELECT USING (
    is_supervisor(auth.uid())
    OR EXISTS (SELECT 1 FROM employees WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Employees read equipment reservations" ON equipment_reservations;
CREATE POLICY "Employees read equipment reservations" ON equipment_reservations
  FOR SELECT USING (
    is_supervisor(auth.uid())
    OR EXISTS (SELECT 1 FROM employees WHERE user_id = auth.uid())
  );

COMMENT ON TABLE inventory_items IS
  'Fix Kimi-M9 (migración 240, 2026-07-21): SELECT restringido a empleados reales (antes cualquier sesión autenticada, incluyendo clientes, por auth.uid() IS NOT NULL sin filtrar por employees).';
COMMENT ON TABLE equipment_reservations IS
  'Fix Kimi-M9 (migración 240, 2026-07-21): SELECT restringido a empleados reales (antes cualquier sesión autenticada, incluyendo clientes, por auth.uid() IS NOT NULL sin filtrar por employees).';

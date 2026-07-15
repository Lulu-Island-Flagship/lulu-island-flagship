-- Migración 155 — v8.3 E5.5: galería post-servicio del cliente (fotos,
-- checklist visual, duración real, nota del líder). No existía ninguna
-- policy de lectura para clientes en `service_logs` -- sin ella, RLS
-- bloquea la fila entera aunque la ruta ya limite qué columnas pide (mismo
-- patrón aceptado que `service_checklist_items` en la migración 138: la
-- restricción de columnas sensibles, ej. location_lat/lng de GPS del
-- empleado, es responsabilidad de la ruta -- nunca se le pide esa columna
-- al cliente -- no de RLS, que es a nivel de fila).

DROP POLICY IF EXISTS "Clients read own service logs" ON service_logs;
CREATE POLICY "Clients read own service logs" ON service_logs
  FOR SELECT USING (
    order_id IN (SELECT id FROM orders WHERE user_id = auth.uid())
  );

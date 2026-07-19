-- v8.3 E3 fix — Policies para tracking de vehículo cliente-facing.
--
-- `vehicles` y `vehicle_tracking` (026_modulo3_capacity_dispatch.sql) solo
-- eran legibles por supervisores (y `vehicles` también por cualquier
-- empleado autenticado). El cliente nunca podía ver la ubicación del equipo
-- yendo a su casa. Esta migración agrega una policy de SOLO LECTURA para
-- clientes, acotada a:
--   1. Un vehículo asignado a una orden que le pertenece (via assignments -> employees).
--   2. La orden debe estar 'confirmed' (no completada/cancelada).
--   3. Dentro de la ventana de 30 min antes del servicio hasta 4h después
--      (mismo criterio que aplica la API en
--      /api/client/orders/[orderId]/vehicle-tracking).
--
-- Nunca se expone employee_id/nombre desde esta policy -- solo columnas de
-- `vehicles` (current_lat/current_lng/last_location_at), que ya vive
-- desacoplada del empleado por diseño (invariante B.2.17: GPS del vehículo,
-- no de la persona).

DROP POLICY IF EXISTS "Clients read assigned vehicle during service window" ON vehicles;
CREATE POLICY "Clients read assigned vehicle during service window" ON vehicles
  FOR SELECT USING (
    id IN (
      SELECT e.vehicle_id
      FROM assignments a
      JOIN employees e ON e.id = a.employee_id
      JOIN orders o ON o.id = a.order_id
      WHERE o.user_id = auth.uid()
        AND o.status = 'confirmed'
        AND e.vehicle_id IS NOT NULL
        AND a.status IN ('pending', 'en_route', 'arrived', 'in_progress')
        AND now() >= (o.service_datetime - INTERVAL '30 minutes')
        AND now() <= (o.service_datetime + INTERVAL '4 hours')
    )
  );

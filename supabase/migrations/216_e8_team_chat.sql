-- Migración 155 — v8.3 E8.12: "Chat interno del equipo del día: solo texto,
-- 160 caracteres, historial 7 días, activo solo en jornada. Prohibido
-- cualquier flag/sanción por discutir salarios (B.2.22)."
--
-- No existe un concepto persistente de "equipo" a nivel de empleado
-- (`teams`, migración 099, es solo identidad/ranking; la composición real
-- del equipo se arma por orden en el dispatch diario -- ver assignments).
-- Por eso el chat se ancla a `order_id`: es el mismo agrupamiento natural
-- que ya usa /api/empleado/servicios para "mis servicios de hoy", y es
-- exactamente "quién trabaja junto hoy" sin inventar una tabla de roster
-- persistente que no existe en el resto del sistema.
--
-- Cumplimiento de B.2.22 (prohibido vigilar/sancionar discusión de
-- salarios): este archivo NO contiene, y nunca debe contener, ningún
-- detector de palabras clave de salario/sueldo ni lógica de sanción sobre
-- el contenido de los mensajes. La ausencia es intencional -- revisar en
-- code review si alguien intenta agregarla.

CREATE TABLE IF NOT EXISTS team_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sender_employee_id UUID NOT NULL REFERENCES employees(id),
  body TEXT NOT NULL CHECK (char_length(body) > 0 AND char_length(body) <= 160),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_team_chat_order_created ON team_chat_messages(order_id, created_at);

ALTER TABLE team_chat_messages ENABLE ROW LEVEL SECURITY;

-- Solo empleados con una asignación (activa o pasada, no soft-deleted) en
-- esa orden pueden leer o escribir -- el mismo criterio de pertenencia que
-- ya usa /api/empleado/servicios.
DROP POLICY IF EXISTS "Assigned employees read team chat" ON team_chat_messages;
CREATE POLICY "Assigned employees read team chat" ON team_chat_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM assignments a
      JOIN employees e ON e.id = a.employee_id
      WHERE a.order_id = team_chat_messages.order_id
        AND e.user_id = auth.uid()
        AND a.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "Assigned employees insert team chat" ON team_chat_messages;
CREATE POLICY "Assigned employees insert team chat" ON team_chat_messages
  FOR INSERT WITH CHECK (
    sender_employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM assignments a
      JOIN employees e ON e.id = a.employee_id
      WHERE a.order_id = team_chat_messages.order_id
        AND e.user_id = auth.uid()
        AND a.deleted_at IS NULL
    )
  );

-- Sin trigger de prevent_hard_delete a propósito: es chat efímero de 7 días
-- (mismo criterio que towel_cycle_log, migración 048 -- no es evidencia
-- legal/financiera). El historial de 7 días se aplica a nivel de consulta
-- (la API filtra created_at >= now() - 7 días), no de borrado físico.

COMMENT ON TABLE team_chat_messages IS
  'v8.3 E8.12: chat interno del equipo del día, anclado a order_id (misma composición que assignments). Solo texto, 160 chars. Nunca debe agregarse detección de palabras de salario (B.2.22).';

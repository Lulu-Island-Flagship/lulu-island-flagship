-- Migración 089 — v8.3 E8: ejecuta la reasignación REAL cuando el timer de
-- 10 min de una alerta de bienestar químico vence sin respuesta del admin.
--
-- Antes de esta migración, /api/cron/wellbeing-chemical-reassign detectaba
-- el vencimiento y marcaba wellbeing_chemical_alerts.resolution =
-- 'auto_reassigned', pero el propio código admitía explícitamente (ver
-- comentario del cron) que no reasignaba nada de verdad: el empleado
-- seguía con la tarea de riesgo químico.
--
-- Reasignación real posible con el esquema actual (no existe "nivel de
-- riesgo por tarea", solo asignación por orden): (a) el empleado reportado
-- queda restringido a tareas de bajo riesgo el resto de la jornada, (b) un
-- compañero YA asignado a la misma orden asume la responsabilidad química
-- (mismo criterio de prioridad que dispatch-team.ts::buildTeam), (c) si no
-- hay compañero disponible, se escala al admin de inmediato vía
-- tickets_disputas (regla pre-aprobada del fallback de 10 min, B.2.12).

ALTER TABLE assignments
  ADD COLUMN IF NOT EXISTS restricted_to_low_risk_at TIMESTAMPTZ;

COMMENT ON COLUMN assignments.restricted_to_low_risk_at IS
  'v8.3 E8: si no es NULL, este empleado quedó restringido a tareas de bajo riesgo el resto de la jornada por una alerta de bienestar químico sin respuesta admin en 10 min.';

ALTER TABLE wellbeing_chemical_alerts
  ADD COLUMN IF NOT EXISTS reassigned_employee_id UUID REFERENCES employees(id),
  ADD COLUMN IF NOT EXISTS escalated_no_backup BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN wellbeing_chemical_alerts.reassigned_employee_id IS
  'v8.3 E8: compañero de equipo que asumió la responsabilidad química de la orden tras la reasignación automática.';
COMMENT ON COLUMN wellbeing_chemical_alerts.escalated_no_backup IS
  'v8.3 E8: true si no había compañero disponible en la orden y se escaló al admin de inmediato (fallback pre-aprobado, no un caso sin resolver).';

-- tickets_disputas.type necesita un valor propio para esta escalación
-- (distinto de dispute/discrepancy/consulta, que son de otro dominio).
ALTER TABLE tickets_disputas DROP CONSTRAINT IF EXISTS tickets_disputas_type_check;
ALTER TABLE tickets_disputas ADD CONSTRAINT tickets_disputas_type_check
  CHECK (type IN ('dispute', 'discrepancy', 'consulta', 'wellbeing_no_backup'));

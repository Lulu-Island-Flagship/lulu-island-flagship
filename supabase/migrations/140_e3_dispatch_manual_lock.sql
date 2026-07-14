-- Migración 140 — v8.3 E3 (D.4): overrides manuales del admin sobreviven
-- la publicación automática de las 5:30 PM.
--
-- Hallazgo (2026-07-14, construyendo la pantalla de revisión del admin):
-- persistAssignments() en /api/cron/dispatch-scheduler SIEMPRE borra e
-- inserta de nuevo las asignaciones de cada orden con su propuesta
-- recién calculada, sin importar si un admin ya asignó manualmente esa
-- orden durante la ventana de revisión 5:00-5:30 PM (POST
-- /api/admin/dispatch, existente desde antes). Resultado: cualquier
-- override manual hecho en la ventana de revisión se PERDÍA silenciosamente
-- al publicarse -- contradice el propósito mismo de D.4 ("5:00-5:30
-- revisión/override del admin").
--
-- Diseño: una asignación "bloqueada" (locked_by_admin=true) es la señal de
-- que un humano ya decidió esta orden a propósito. El publicador del
-- scheduler debe saltarla, nunca sobreescribirla. El desbloqueo es
-- implícito: si el admin vuelve a llamar al mismo POST manual, se
-- re-bloquea con el nuevo valor (siempre gana la decisión humana más
-- reciente).
--
-- Propiedad de tabla: assignments es de Módulo 3/E3 (003_modulo3_employee_tables.sql).

ALTER TABLE assignments
  ADD COLUMN IF NOT EXISTS locked_by_admin BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS locked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;

COMMENT ON COLUMN assignments.locked_by_admin IS
  'v8.3 E3/D.4: true cuando un admin asignó esta orden manualmente (POST /api/admin/dispatch). El publicador automático de las 5:30 PM (persistAssignments) debe saltar las órdenes bloqueadas -- nunca las borra ni las reemplaza.';

CREATE INDEX IF NOT EXISTS idx_assignments_locked
  ON assignments(order_id)
  WHERE locked_by_admin = true;

-- v8.3 fix (auditoría UX/UI/seguridad 2026-07-25, P0 #1) — Bypass de
-- geocerca sin supervisión real.
--
-- Hallazgo: un T_in con geofence_bypass=true (empleado fuera del radio de
-- 50m) quedaba, en la práctica, tan "aprobado" como cualquier check-in
-- normal -- assignments.status pasaba a 'arrived' de inmediato y el
-- empleado podía seguir con T_start/T_out sin que ningún supervisor
-- hubiera revisado ni aprobado nada en tiempo real. Las 3 salvaguardas
-- (countdown, foto, razón) solo generan evidencia para una revisión
-- POSTERIOR -- no son una aprobación.
--
-- Esta migración agrega el estado explícito de esa revisión pendiente,
-- para que quede registrado en base de datos que el bypass NO está
-- aprobado, solo flaggeado y a la espera de que un supervisor lo revise.
--
-- IMPORTANTE (limitación conocida, ver comentario en route.ts): no existe
-- todavía infraestructura de notificaciones push/email al supervisor en
-- este repo -- esta columna deja el registro persistido y consultable,
-- pero la notificación en tiempo real al supervisor queda pendiente de
-- una integración futura (no se inventa aquí infraestructura que no
-- existe). Tampoco existe todavía una pantalla admin para listar/aprobar
-- estos bypasses -- queda como trabajo de seguimiento.

ALTER TABLE service_logs
  ADD COLUMN IF NOT EXISTS geofence_bypass_review_status TEXT,
  ADD COLUMN IF NOT EXISTS geofence_bypass_reviewed_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS geofence_bypass_reviewed_at TIMESTAMPTZ;

ALTER TABLE service_logs DROP CONSTRAINT IF EXISTS service_logs_geofence_bypass_review_status_check;
ALTER TABLE service_logs ADD CONSTRAINT service_logs_geofence_bypass_review_status_check
  CHECK (
    geofence_bypass_review_status IS NULL OR geofence_bypass_review_status IN (
      'pending_supervisor_review',
      'approved',
      'rejected'
    )
  );

COMMENT ON COLUMN service_logs.geofence_bypass_review_status IS
  'v8.3 fix (auditoría 2026-07-25, P0 #1): NULL para logs sin bypass. '
  'Para todo T_in con geofence_bypass=true, POST /api/empleado/servicio lo '
  'inserta SIEMPRE como ''pending_supervisor_review'' -- nunca ''approved'' '
  'automáticamente. Falta UI admin para transicionar a approved/rejected y '
  'notificación push real al supervisor (no implementadas todavía).';

COMMENT ON COLUMN service_logs.geofence_bypass_reviewed_by IS
  'v8.3 fix (auditoría 2026-07-25, P0 #1): supervisor/admin que resolvió la '
  'revisión pendiente. NULL mientras geofence_bypass_review_status = '
  'pending_supervisor_review.';

COMMENT ON COLUMN service_logs.geofence_bypass_reviewed_at IS
  'v8.3 fix (auditoría 2026-07-25, P0 #1): timestamp de la resolución de la '
  'revisión (approved/rejected). NULL mientras está pendiente.';

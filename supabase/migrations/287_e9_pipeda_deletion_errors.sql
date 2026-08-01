-- Fix (auditoría 2026-07-31, item 4): el cascade de soft-delete de una
-- solicitud PIPEDA de ELIMINACIÓN (derecho al olvido, request_type =
-- 'deletion') escribía sus errores parciales en `correction_details`, una
-- columna documentada explícitamente (migración 142) como "qué se corrige
-- (solo request_type = correction)" -- semánticamente equivocada para una
-- solicitud de borrado. Se agrega una columna dedicada, sin tocar
-- `correction_details` (sigue existiendo, sigue siendo solo para
-- correcciones).
ALTER TABLE data_subject_requests
  ADD COLUMN IF NOT EXISTS deletion_errors TEXT; -- errores parciales del cascade de borrado (solo request_type = 'deletion')

COMMENT ON COLUMN data_subject_requests.deletion_errors IS
  'Errores parciales (JSON serializado como texto) del cascade de soft-delete de una solicitud de eliminación PIPEDA. Solo aplica a request_type = deletion. No confundir con correction_details (solo para request_type = correction).';

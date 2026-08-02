-- Fix (auditoría de integridad de datos 2026-08-01, Agente 4): PATCH
-- /api/admin/pipeda/requests/[id] (action=complete, request_type=deletion)
-- usaba Promise.allSettled para el cascade de soft-delete y marcaba la
-- solicitud como 'completed' SIEMPRE, incluso si una o más de las
-- promesas del cascade habían fallado -- solo dejaba un texto informativo
-- en `deletion_errors`. Para una solicitud PIPEDA de "derecho al olvido",
-- marcar 'completed' con borrados parciales es un falso registro de
-- cumplimiento: un auditor (o el propio titular) vería la solicitud
-- cerrada exitosamente aunque, por ejemplo, `orders` nunca se haya
-- borrado.
--
-- Fix: se agrega el status 'partial_failure' -- si CUALQUIER paso del
-- cascade falla, la solicitud queda en este estado (no 'completed') con el
-- detalle de qué falló en `deletion_errors`, para reintento manual. Solo
-- se marca 'completed' si el cascade completo tuvo éxito.

ALTER TABLE data_subject_requests
  DROP CONSTRAINT IF EXISTS data_subject_requests_status_check;

ALTER TABLE data_subject_requests
  ADD CONSTRAINT data_subject_requests_status_check
  CHECK (status IN ('pending', 'processing', 'completed', 'denied', 'partial_failure'));

COMMENT ON COLUMN data_subject_requests.status IS
  'pending/processing/completed/denied (flujo normal) o partial_failure (fix 2026-08-01): el cascade de soft-delete de una solicitud de eliminación tuvo uno o más errores parciales -- ver deletion_errors para el detalle. Requiere reintento manual antes de poder marcarse completed.';

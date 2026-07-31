-- v0.4.1 (flujo de contratación) -- Fase 2 "Modelo de Datos Completo".
-- `audit_logs` es el log de auditoría genérico del módulo: quién
-- (`actor_type`/`actor_id`) hizo qué (`action`) sobre qué entidad
-- (`entity_type`/`entity_id`), con contexto libre en `metadata`.
--
-- Por qué `actor_id` es UUID sin FK (a diferencia de casi todo lo demás
-- en este módulo, que sí declara FKs explícitas): el actor puede ser un
-- `hr_users.id`, un `candidates.id`, o no aplicar en absoluto
-- (`actor_type = 'system'`, ej. un job de limpieza automático). Una FK
-- fija apuntaría a una sola tabla y no puede modelar "referencia
-- polimórfica" sin una columna adicional de discriminación fuera de
-- alcance de esta migración -- se prioriza que el log NUNCA falle un
-- INSERT por una FK rota (el log debe poder registrar el evento incluso
-- si la entidad referenciada fue borrada después, o si el actor no
-- corresponde a ninguna tabla). `entity_id` es UUID sin FK por la misma
-- razón (entity_type ya indica a qué tabla pertenece conceptualmente).
--
-- Por qué esta tabla, igual que electronic_signatures (262) y consents
-- (263), es solo INSERT+SELECT sin UPDATE/DELETE: un log de auditoría
-- que se puede editar o borrar no sirve como auditoría -- debe ser
-- append-only por definición.

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('hr_user', 'candidate', 'system')),
  actor_id UUID,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs (actor_type, actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Solo INSERT y SELECT, service-role-only. Deliberadamente SIN policy de
-- UPDATE ni DELETE -- log append-only, mismo patrón que
-- electronic_signatures (262) y consents (263).
DROP POLICY IF EXISTS "audit_logs no direct insert" ON audit_logs;
CREATE POLICY "audit_logs no direct insert" ON audit_logs
  FOR INSERT WITH CHECK (false);
DROP POLICY IF EXISTS "audit_logs no direct select" ON audit_logs;
CREATE POLICY "audit_logs no direct select" ON audit_logs
  FOR SELECT USING (false);

COMMENT ON TABLE audit_logs IS
  'v0.4.1 flujo de contratación: log de auditoría append-only (actor, '
  'acción, entidad, metadata). actor_id/entity_id son UUID sin FK a '
  'propósito (referencia polimórfica -- el log nunca debe fallar por '
  'una FK rota). Sin policy de UPDATE/DELETE. Acceso exclusivo vía '
  'service role.';

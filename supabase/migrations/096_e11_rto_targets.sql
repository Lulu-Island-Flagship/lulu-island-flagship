-- Migración 096 — v8.3 E11.3: Niveles de RTO (Recovery Time Objective) por
-- tipo de dato/componente, como datos estructurados en tabla — no solo
-- prosa en el plan — para que el admin los vea en pantalla
-- (GET /api/admin/dr-drill) y pueda editarlos cuando el dueño defina los
-- valores reales de negocio.
--
-- IMPORTANTE — de dónde salen los valores sembrados: NO son inventados por
-- esta migración. Son una transcripción literal de v8.3_PLAN_DE_CONSTRUCCION.md,
-- sección E11, punto 3: "Supabase temporal <1h (cache) / >24h <48h
-- (pg_dump→RDS/Render) / Vercel <30 min (estático) / dev desaparecido <7 días
-- (kit) / dueño incapacitado inmediato / todo destruido <14 días (B2)."
-- Se marcan is_example = true porque, aunque el NÚMERO viene del plan, el
-- plan mismo los presenta como el diseño a implementar, no como una política
-- de negocio ya operada y probada — is_example indica "aún no confirmado con
-- un simulacro real cronometrado" (se pasa a false la primera vez que un
-- disaster_recovery_drills.result='pass' cronometrado confirma el número).
-- Ningún valor aquí fue inventado por fuera del plan; el dueño puede
-- editarlos vía SQL/admin cuando redefina la política real.

CREATE TABLE IF NOT EXISTS rto_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data_type TEXT NOT NULL UNIQUE,
  -- >= 0, no > 0: 'owner_incapacitated' declara RTO=0 a propósito (activación
  -- inmediata de Modo Sucesión, sin ventana de espera diseñada — ver INSERT
  -- más abajo). Un CHECK > 0 rechazaría ese valor real y válido.
  rto_hours NUMERIC NOT NULL CHECK (rto_hours >= 0),
  recovery_method TEXT NOT NULL,
  is_example BOOLEAN NOT NULL DEFAULT true,
  source TEXT NOT NULL DEFAULT 'v8.3_PLAN_DE_CONSTRUCCION.md E11.3',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE rto_targets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner reads rto targets" ON rto_targets;
CREATE POLICY "owner reads rto targets" ON rto_targets
  FOR SELECT USING (has_admin_role(auth.uid(), ARRAY['owner_admin']));

DROP POLICY IF EXISTS "owner manages rto targets" ON rto_targets;
CREATE POLICY "owner manages rto targets" ON rto_targets
  FOR UPDATE USING (has_admin_role(auth.uid(), ARRAY['owner_admin']))
  WITH CHECK (has_admin_role(auth.uid(), ARRAY['owner_admin']));

DROP TRIGGER IF EXISTS trg_prevent_delete ON rto_targets;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON rto_targets
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

INSERT INTO rto_targets (data_type, rto_hours, recovery_method, notes) VALUES
  ('supabase_temporary_outage', 1, 'Cache local / degradación funcional mientras Supabase se recupera solo', 'Caída corta gestionada por el proveedor; sin acción de restore.'),
  ('supabase_extended_outage', 48, 'pg_dump mensual → restaurar en RDS/Render como base temporal', 'Caída >24h; usa el pg_dump más reciente, riesgo de pérdida de datos desde el último dump.'),
  ('vercel_outage', 0.5, 'Redeploy estático / fallback a proveedor alterno', 'Frontend, sin estado — el RTO más corto del sistema.'),
  ('developer_unavailable', 168, 'Kit de emergencia físico (sobre sellado): credenciales, deploy, arquitectura, contactos', '7 días — cubre ausencia del desarrollador, no del dueño.'),
  ('owner_incapacitated', 0, 'Modo Sucesión (E11.1): activación inmediata con documento legal / declaración de incapacidad', 'RTO=0 declarado en el plan: la activación es inmediata, no hay ventana de espera diseñada.'),
  ('total_infrastructure_loss', 336, 'Restauración completa desde Backblaze B2 (backups inmutables con hash SHA-256)', '14 días — escenario máximo, todo destruido.')
ON CONFLICT (data_type) DO NOTHING;

COMMENT ON TABLE rto_targets IS
  'v8.3 E11.3: RTO declarado por tipo de dato/componente, transcrito literal del plan (ver comentario de migración). is_example=true hasta que un simulacro cronometrado (disaster_recovery_drills) confirme el número.';

-- Migración 167 — v8.3 E9.10: "Backups: transacciones diario, nómina por
-- ciclo, clientes semanal, fotos mensual, pg_dump mensual restaurable."
--
-- Log inmutable de cada corrida de backup (qué tipo, cuándo, a dónde, con
-- qué hash). Ver honestidad de alcance en src/lib/backup-jobs.ts -- el
-- destino real hoy es 'supabase_storage_fallback' (B2/Glacier no
-- conectado todavía; pg_dump real requiere acceso directo psql que no
-- existe desde una función serverless).

CREATE TABLE IF NOT EXISTS backup_job_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type TEXT NOT NULL CHECK (job_type IN (
    'transactions_daily', 'payroll_per_cycle', 'clients_weekly', 'photos_monthly', 'pg_dump_monthly'
  )),
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  destination TEXT NOT NULL CHECK (destination IN ('supabase_storage_fallback', 'b2', 's3_glacier', 'not_configured', 'reminder_only')),
  storage_path TEXT,
  sha256_hash TEXT,
  row_count INTEGER,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'not_configured')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_backup_job_runs_type_created ON backup_job_runs(job_type, created_at DESC);

-- Inmutable: es el rastro de auditoría de qué se respaldó y cuándo.
DROP TRIGGER IF EXISTS trg_prevent_delete ON backup_job_runs;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON backup_job_runs
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

ALTER TABLE backup_job_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Supervisors read backup job runs" ON backup_job_runs;
CREATE POLICY "Supervisors read backup job runs" ON backup_job_runs
  FOR SELECT USING (is_supervisor(auth.uid()));

COMMENT ON TABLE backup_job_runs IS
  'v8.3 E9.10: log inmutable de corridas de backup (transacciones/nómina/clientes/fotos/pg_dump). src/lib/backup-jobs.ts decide cuándo toca correr cada uno y construye el CSV+hash.';

-- Bucket privado para los CSV+hash de backup (fallback dentro del mismo
-- proveedor mientras no haya credenciales de B2/Glacier configuradas).
INSERT INTO storage.buckets (id, name, public)
VALUES ('backups', 'backups', false)
ON CONFLICT (id) DO NOTHING;

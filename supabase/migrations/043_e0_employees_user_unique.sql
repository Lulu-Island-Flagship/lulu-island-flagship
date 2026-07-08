-- ============================================================
-- E0 RETROFIT — employees.user_id debe ser único
-- Detectado en db reset real: el seed (y la lógica de is_supervisor, despacho
-- y nómina) asumen UNA fila de employee por usuario auth, pero la restricción
-- nunca existió. Idempotente.
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'employees_user_id_unique'
  ) THEN
    ALTER TABLE employees ADD CONSTRAINT employees_user_id_unique UNIQUE (user_id);
  END IF;
END $$;

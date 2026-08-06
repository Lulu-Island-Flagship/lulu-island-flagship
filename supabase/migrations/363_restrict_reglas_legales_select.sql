-- Migration 363: Restrict reglas_legales SELECT by estado
-- Auditoría 2026-08-06: cualquier authenticated podía leer TODAS las versiones
-- de reglas legales (VIGENTE, PENDIENTE, HISTORICO). Las versiones HISTORICO
-- pueden contener notas de error internas que no deberían ser públicas.
-- Se crean dos políticas: authenticated ve solo VIGENTE, supervisors ven todo.

BEGIN;

DROP POLICY IF EXISTS "Authenticated read legal rules" ON reglas_legales;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'reglas_legales'
      AND policyname = 'Authenticated read active legal rules'
  ) THEN
    CREATE POLICY "Authenticated read active legal rules"
      ON reglas_legales FOR SELECT
      USING (auth.role() = 'authenticated' AND estado = 'VIGENTE');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'reglas_legales'
      AND policyname = 'Supervisors read all legal rules'
  ) THEN
    CREATE POLICY "Supervisors read all legal rules"
      ON reglas_legales FOR SELECT
      USING (is_supervisor(auth.uid()));
  END IF;
END $$;

COMMIT;

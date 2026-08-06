-- Migration 364: Add sentinel guard against re-running dollar-to-cents conversion
-- Auditoría 2026-08-06: la migración 229 convirtió dólares a centavos con un
-- UPDATE ×100 in-place que es NO IDEMPOTENTE. Re-ejecutarlo multiplicaría
-- todos los valores por 100 de nuevo, corrompiendo datos financieros.
-- Este comentario en la tabla orders sirve como marker verificable:
--   SELECT obj_description('orders'::regclass);
-- Si contiene 'cents_conversion_applied', la conversión ya se aplicó.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_description
    WHERE objoid = 'orders'::regclass
    AND objsubid = 0
    AND description LIKE '%cents_conversion_applied%'
  ) THEN
    COMMENT ON TABLE orders IS
      'cents_conversion_applied (migration 229): all monetary columns are in INTEGER cents, not dollars. DO NOT re-run the ×100 conversion.';
  END IF;
END $$;

COMMIT;

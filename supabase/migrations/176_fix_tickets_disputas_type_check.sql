-- Migración 176 — FIX de bug real encontrado durante FIX-6/FIX-9: cada
-- migración anterior que necesitaba un tipo nuevo para tickets_disputas.type
-- hacía DROP CONSTRAINT + ADD CONSTRAINT con la lista COMPLETA reescrita en
-- vez de agregar el valor nuevo a la lista ya vigente:
--   010 → ('dispute','discrepancy','consulta')
--   073 → ('dispute','discrepancy','consulta','payment_failure')          [reescribió 010]
--   089 → ('dispute','discrepancy','consulta','wellbeing_no_backup')      [reescribió 073 -- perdió 'payment_failure']
--
-- Resultado real: src/app/api/cron/batch-capture-retry/route.ts inserta
-- type='payment_failure' desde la migración 073, pero desde que se aplicó
-- la 089 ese insert viola el CHECK constraint vigente y falla en runtime
-- (silenciosamente, porque el código no revisa el error de ese insert
-- específico) -- los tickets de fallo de pago simplemente dejaron de
-- crearse. Esta migración restaura 'payment_failure' y agrega los dos tipos
-- nuevos de esta sesión (upsell_approval del FIX-6, hours_dispute del
-- FIX-9), esta vez con la lista completa acumulada para no repetir el bug.

ALTER TABLE tickets_disputas DROP CONSTRAINT IF EXISTS tickets_disputas_type_check;
ALTER TABLE tickets_disputas ADD CONSTRAINT tickets_disputas_type_check
  CHECK (type IN (
    'dispute',
    'discrepancy',
    'consulta',
    'payment_failure',
    'wellbeing_no_backup',
    'upsell_approval',
    'hours_dispute'
  ));

COMMENT ON COLUMN tickets_disputas.type IS
  'v8.3 migración 176: lista acumulada real de todos los tipos que el código inserta. Migraciones anteriores (073, 089) reescribían esta lista en vez de extenderla y perdían valores -- toda migración futura que agregue un tipo debe copiar esta lista completa, no partir de la definición original de 010.';

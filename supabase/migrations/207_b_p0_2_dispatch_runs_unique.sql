-- Auditoría 2026-07-21 (INFORME_LOGICA_NEGOCIO_ROLES) — B-P0-2:
-- El guard anti-doble-ejecución de /api/cron/batch-capture (y de cualquier
-- otro consumidor de dispatch_runs) es un read-then-insert: SELECT por
-- (run_date, phase), y si no hay fila, INSERT. Sin una restricción UNIQUE
-- real, dos invocaciones concurrentes del mismo cron (dos triggers del
-- scheduler externo, un retry manual solapado con el disparo automático,
-- etc.) pueden pasar ambas el SELECT antes de que cualquiera complete el
-- INSERT, y las dos procesan el mismo lote de captura de saldo → doble
-- cobro potencial en todas las órdenes del lote.
--
-- Fix: convertir el índice no-único idx_dispatch_runs_date_phase (026) en
-- una restricción UNIQUE real sobre (run_date, phase). El código que hace
-- el INSERT debe tratar el 23505 (unique_violation) como "otra invocación
-- ya está corriendo este run" y salir sin procesar, en vez de fallar la
-- petición completa.
--
-- Antes de crear la restricción, se eliminan duplicados existentes por
-- (run_date, phase) preservando la fila más antigua (la que originalmente
-- "ganó" la carrera), para que la migración no falle si el bug ya produjo
-- duplicados en producción.
DELETE FROM dispatch_runs a
USING dispatch_runs b
WHERE a.run_date = b.run_date
  AND a.phase = b.phase
  AND a.created_at > b.created_at;

DROP INDEX IF EXISTS idx_dispatch_runs_date_phase;

ALTER TABLE dispatch_runs
  ADD CONSTRAINT dispatch_runs_run_date_phase_key UNIQUE (run_date, phase);

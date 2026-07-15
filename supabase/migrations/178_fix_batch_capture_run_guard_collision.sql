-- v8.3 — Bug crítico encontrado en auditoría de flujo cliente (2026-07-15):
-- /api/cron/batch-capture usaba dispatch_runs{run_date=hoy, phase='published'}
-- como guard de "ya corrí hoy". Pero /api/cron/dispatch-scheduler inserta esa
-- MISMA fila (run_date = mañana, phase='published') todos los días a las
-- 17:30 Vancouver al publicar el equipo del día siguiente. Resultado: cada
-- día a las 19:00, batch-capture encontraba la fila que dispatch-scheduler
-- insertó el día anterior para "hoy" y se saltaba TODA la captura de saldo
-- restante, silenciosamente, todos los días.
--
-- Efecto colateral adicional: el INSERT de batch-capture con phase='published'
-- disparaba trg_publish_slots (migración 026), publicando slots de capacidad
-- sin ninguna relación con el propósito real del insert (marcar inicio de un
-- run de cobro).
--
-- Fix: agregar 'batch_capture' como fase válida y separada, para que
-- batch-capture nunca comparta filas con el scheduler de despacho.
ALTER TABLE dispatch_runs DROP CONSTRAINT IF EXISTS dispatch_runs_phase_check;
ALTER TABLE dispatch_runs ADD CONSTRAINT dispatch_runs_phase_check
  CHECK (phase IN ('proposal', 'cutoff', 'published', 'simulation', 'crisis_fallback', 'batch_capture'));

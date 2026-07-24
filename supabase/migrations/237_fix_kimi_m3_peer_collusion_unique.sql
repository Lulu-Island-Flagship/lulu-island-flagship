-- Fix Kimi-M3 (auditoría externa Kimi Code, 2026-07-21, cita exacta y
-- confirmada real): peer_vote_collusion_flags (migración 215) no tiene
-- ninguna restricción de unicidad sobre (employee_a, employee_b,
-- week_start). src/app/api/cron/weekly-scores/route.ts hace un INSERT
-- plano (sin ON CONFLICT) por cada par recíproco detectado -- si el cron
-- se reintenta o corre dos veces para la misma semana (reintento manual,
-- invocación duplicada de Vercel Cron, etc.), duplica banderas de
-- colusión para el mismo par de empleados.
--
-- Nota: employee_a/employee_b no tienen un orden canónico garantizado en
-- detectReciprocalHighRatings() -- para no asumir cuál función de negocio
-- decide el orden del par, el índice único se define sobre LEAST/GREATEST
-- de los dos ids, así que (A,B) y (B,A) para la misma semana también se
-- tratan como el mismo par (evita duplicar la bandera aunque el orden de
-- los ids cambie entre corridas).
CREATE UNIQUE INDEX IF NOT EXISTS uq_peer_vote_collusion_pair_week
  ON peer_vote_collusion_flags (
    week_start,
    LEAST(employee_a, employee_b),
    GREATEST(employee_a, employee_b)
  )
  WHERE deleted_at IS NULL;

COMMENT ON INDEX uq_peer_vote_collusion_pair_week IS
  'Fix Kimi-M3 (migración 237, 2026-07-21): evita banderas de colusión duplicadas para el mismo par de empleados en la misma semana si el cron weekly-scores se reintenta o corre dos veces.';

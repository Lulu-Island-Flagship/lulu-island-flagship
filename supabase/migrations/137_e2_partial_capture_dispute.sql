-- Migración 137 — v8.3 E2: captura parcial mínima cuando el Batch Capture
-- (7PM) encuentra una disputa crítica documentada.
--
-- Contexto (decisión del dueño, 2026-07-13): la migración 080 dejó dos
-- comportamientos posibles detrás de 'batch_capture_dispute_exclusion_enabled'
-- (apagado): cobrar todo igual (legacy) o no cobrar nada y encolar para
-- revisión manual. El dueño pidió un tercer comportamiento, más fiel a
-- B.2.2 ("el pago no se congela por defecto") pero sin exponer a Lulu
-- Island a pagar nómina con dinero que no llegó a cobrarle al cliente:
--   1. Cobrar DE INMEDIATO, como mínimo, el costo laboral de la orden
--      (Σ payroll_entries.gross_amount) + 10% de colchón.
--   2. Cobrar el resto a las 24 horas (src/lib/batch-capture-partial.ts +
--      nuevo cron capture-remainder).
--   3. El admin puede forzar el cobro COMPLETO inmediato pese a la disputa
--      (force-full-capture), quedando auditado.
--
-- Diseño de flags: 'batch_capture_dispute_exclusion_enabled' (080) sigue
-- significando "hay una regla de exclusión activa" -- se mantiene para no
-- romper nada ya probado. Este flag nuevo, cuando está prendido, hace que
-- esa exclusión se resuelva como captura parcial en vez de cobro cero. Si
-- este flag está apagado pero el de 080 sigue prendido, el comportamiento
-- vuelve a ser el histórico de 080 (cobro cero + cola manual). Ambos
-- apagados = comportamiento legacy pre-080 (se cobra todo igual). Mismo
-- patrón de "nunca cambia comportamiento de dinero sin flag explícito" que
-- todo lo demás en E2.
--
-- Propiedad de tabla: orders es de E1/E2 (dueño de columnas de captura
-- desde 001). payroll_entries es de E2 (021) -- solo se LEE aquí, no se
-- escribe.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS capture_partial_amount INTEGER,
  ADD COLUMN IF NOT EXISTS capture_partial_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS capture_remaining_amount INTEGER,
  ADD COLUMN IF NOT EXISTS capture_remaining_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS capture_remaining_captured_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS capture_remaining_payment_intent_id TEXT,
  ADD COLUMN IF NOT EXISTS capture_remaining_last_error TEXT,
  ADD COLUMN IF NOT EXISTS capture_remaining_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS capture_force_full_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS capture_force_full_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS capture_force_full_reason TEXT;

COMMENT ON COLUMN orders.capture_partial_amount IS
  'v8.3 E2 (2026-07-13): monto capturado de inmediato en el batch de 7PM cuando había disputa crítica documentada -- costo laboral + 10%, nunca el total. NULL si nunca aplicó captura parcial a esta orden.';
COMMENT ON COLUMN orders.capture_remaining_amount IS
  'Monto pendiente de cobrar a las 24h tras una captura parcial. Se pone a 0 (no NULL) una vez capturado, para distinguir "nunca hubo remanente" (NULL) de "ya se cobró" (0).';
COMMENT ON COLUMN orders.capture_remaining_due_at IS
  'Cuándo debe correr /api/cron/capture-remainder para esta orden. NULL si no hay remanente pendiente.';
COMMENT ON COLUMN orders.capture_force_full_by IS
  'Admin que forzó el cobro completo inmediato pese a la disputa abierta (force-full-capture). NULL = nunca se forzó.';

CREATE INDEX IF NOT EXISTS idx_orders_capture_remaining_due
  ON orders(capture_remaining_due_at)
  WHERE capture_remaining_due_at IS NOT NULL AND capture_remaining_captured_at IS NULL;

-- Feature flag — apagado por defecto, mismo patrón que 080.
INSERT INTO feature_flags (nombre, activo, modulo, descripcion)
VALUES (
  'batch_capture_partial_on_dispute_enabled',
  false,
  'E2',
  'Cuando hay disputa crítica documentada en el batch de 7PM: cobrar de inmediato costo laboral+10% y el resto a las 24h, en vez de no cobrar nada. Requiere que batch_capture_dispute_exclusion_enabled también esté prendido.'
)
ON CONFLICT (nombre) DO UPDATE SET activo = false;

-- Flag separado para el cron que efectivamente cobra el remanente a las
-- 24h (/api/cron/capture-remainder) -- mismo patrón que
-- batch_capture_retry_enabled: puede haber remanentes programados (el flag
-- de arriba encendido) sin que el cron de cobro esté autorizado a correr
-- todavía, para poder probar la generación de remanentes en staging antes
-- de autorizar el cobro real.
INSERT INTO feature_flags (nombre, activo, modulo, descripcion)
VALUES (
  'capture_remainder_cron_enabled',
  false,
  'E2',
  'Autoriza a /api/cron/capture-remainder a cobrar de verdad los remanentes de captura parcial vencidos. Apagado = dry-run (cuenta candidatos, no cobra).'
)
ON CONFLICT (nombre) DO UPDATE SET activo = false;

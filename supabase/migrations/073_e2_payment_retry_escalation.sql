-- Migración 073 — v8.3 E2: reintento de cobro 10 PM + escalación a admin.
--
-- Contexto (v8.3 D.10 excepción 9 / E2.3): "Pre-autorización silenciosa 2h
-- antes; falla → SMS con link de actualización → retry 10 PM → admin
-- (excepción D.10.9)." Esta migración cubre el tramo retry 10PM → admin:
-- el Batch Capture de las 7PM (route.ts existente) ya deja capture_attempts
-- incrementado en cada fallo. Este job la retoma a las 10PM.

-- ============================================================
-- 1. Guard genérico anti-doble-ejecución para crons diarios
-- (Vercel Cron corre en UTC y algunos jobs se invocan 2 veces por DST;
-- dispatch_runs no sirve aquí porque su CHECK de phase es específico de
-- despacho. Esta tabla es de propósito general y reusable.)
-- ============================================================
CREATE TABLE IF NOT EXISTS cron_execution_guard (
  job_name TEXT NOT NULL,
  run_date DATE NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (job_name, run_date)
);

ALTER TABLE cron_execution_guard ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Supervisors read cron guard" ON cron_execution_guard;
CREATE POLICY "Supervisors read cron guard" ON cron_execution_guard
  FOR SELECT USING (is_supervisor(auth.uid()));

DROP POLICY IF EXISTS "System manage cron guard" ON cron_execution_guard;
CREATE POLICY "System manage cron guard" ON cron_execution_guard
  FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- 2. Registro de notificaciones de recuperación de pago (SMS)
-- No hay proveedor de SMS integrado todavía (ver src/lib/sms.ts, TODO
-- explícito). Esta tabla registra el INTENTO de notificación para
-- trazabilidad, aunque el envío real esté pendiente de credenciales.
-- ============================================================
CREATE TABLE IF NOT EXISTS payment_recovery_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms')),
  trigger_reason TEXT NOT NULL
    CHECK (trigger_reason IN ('capture_attempts_exhausted')),
  payment_link TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_configured'
    CHECK (status IN ('not_configured', 'queued', 'sent', 'failed')),
  provider_response TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_recovery_notifications_order
  ON payment_recovery_notifications(order_id);

ALTER TABLE payment_recovery_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Supervisors read payment recovery notifications" ON payment_recovery_notifications;
CREATE POLICY "Supervisors read payment recovery notifications" ON payment_recovery_notifications
  FOR SELECT USING (is_supervisor(auth.uid()));

DROP POLICY IF EXISTS "System insert payment recovery notifications" ON payment_recovery_notifications;
CREATE POLICY "System insert payment recovery notifications" ON payment_recovery_notifications
  FOR INSERT WITH CHECK (true);

-- ============================================================
-- 3. Escalación a la bandeja unificada (tickets_disputas, migración 010)
-- Se agrega el tipo 'payment_failure' al CHECK existente. Prioridad alta
-- fija: fallo de cobro agotado los 3 intentos entra como excepción D.10.9.
-- ============================================================
ALTER TABLE tickets_disputas DROP CONSTRAINT IF EXISTS tickets_disputas_type_check;
ALTER TABLE tickets_disputas ADD CONSTRAINT tickets_disputas_type_check
  CHECK (type IN ('dispute', 'discrepancy', 'consulta', 'payment_failure'));

-- ============================================================
-- 4. Feature flag: mientras esté apagado, el cron de reintento corre en
-- modo "dry run" (calcula y loguea, no cobra ni escala). Encendido =
-- decisión del dueño, igual que los demás flags de dinero de este módulo.
-- ============================================================
INSERT INTO feature_flags (nombre, activo, modulo, descripcion)
VALUES ('batch_capture_retry_enabled', false, 'E2', 'Reintento de cobro fallido a las 10PM + escalación SMS/admin')
ON CONFLICT (nombre) DO UPDATE SET activo = false;

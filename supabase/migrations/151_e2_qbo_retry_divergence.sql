-- Migración 151 — v8.3 E2.6: conciliación QBO 2:00 AM con reintentos y
-- backoff (5 intentos), y alerta de divergencia Shadow Ledger vs QBO >0.1%.
--
-- El cron cron/qbo-sync existía desde el módulo 2 pero con un TODO explícito:
-- no tenía columnas para contar reintentos ni tabla para registrar
-- divergencia. La llamada real a la API de QBO sigue sin credenciales
-- (adaptador honesto not_configured, src/lib/qbo-adapter.ts) -- lo que esta
-- migración cierra es la lógica de reintento/backoff y de detección de
-- divergencia que el spec exige independientemente de si el proveedor real
-- ya está conectado.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS qbo_sync_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qbo_last_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qbo_last_error TEXT;

-- 'pending_sync' = agotó los 5 reintentos con backoff sin éxito; queda fuera
-- del barrido automático hasta que un admin lo revise o el proveedor vuelva.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_qbo_export_status_check;
ALTER TABLE orders
  ADD CONSTRAINT orders_qbo_export_status_check
  CHECK (qbo_export_status IN ('pending', 'exported', 'failed', 'pending_sync'));

CREATE TABLE IF NOT EXISTS qbo_divergence_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_date DATE NOT NULL UNIQUE,
  shadow_total_cents BIGINT NOT NULL,
  qbo_total_cents BIGINT NOT NULL,
  divergence_ratio NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE qbo_divergence_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner reads qbo divergence alerts" ON qbo_divergence_alerts;
CREATE POLICY "Owner reads qbo divergence alerts" ON qbo_divergence_alerts
  FOR SELECT USING (has_admin_role(auth.uid(), ARRAY['owner_admin']));

COMMENT ON TABLE qbo_divergence_alerts IS
  'v8.3 E2.6: una fila por día en que Shadow Ledger y QBO exportado difieren >0.1%. UNIQUE(alert_date) evita duplicar si el cron corre más de una vez el mismo día.';

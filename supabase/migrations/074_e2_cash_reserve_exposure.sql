-- Migración 074 — v8.3 E2.9: flujo de caja — reserva de impuestos (12%)
-- y tope de exposición diaria de efectivo sin cobrar.
--
-- Alcance de esta migración (literal del plan E2.9 + invariante B.1):
--   "reserva de impuestos 12% (propinas/no gravables separadas)"
--   "tope de exposición diaria (Holds pendientes > X% de caja → alerta)"
-- NO incluye: proyección de caja a 30 días, reserva de chargebacks (ya
-- existe, migración 024) ni fondo de emergencia — esos quedan fuera del
-- alcance pedido en esta sesión.

-- ============================================================
-- 1. Ledger de reserva de impuestos (tracking virtual, no mueve dinero
-- real; Stripe ya cobró el monto completo, esto solo separa la porción
-- que corresponde a GST 5% + PST 7% para no gastarla como operativo).
-- ============================================================
CREATE TABLE IF NOT EXISTS cash_tax_reserve_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  gross_amount_cents INTEGER NOT NULL CHECK (gross_amount_cents >= 0),
  tip_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (tip_amount_cents >= 0),
  non_taxable_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (non_taxable_amount_cents >= 0),
  taxable_base_cents INTEGER NOT NULL CHECK (taxable_base_cents >= 0),
  tax_reserve_cents INTEGER NOT NULL CHECK (tax_reserve_cents >= 0),
  operational_amount_cents INTEGER NOT NULL CHECK (operational_amount_cents >= 0),
  reserve_rate NUMERIC(5,4) NOT NULL DEFAULT 0.12,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cash_tax_reserve_ledger_order ON cash_tax_reserve_ledger(order_id);
CREATE INDEX IF NOT EXISTS idx_cash_tax_reserve_ledger_created ON cash_tax_reserve_ledger(created_at);

ALTER TABLE cash_tax_reserve_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Supervisors read tax reserve ledger" ON cash_tax_reserve_ledger;
CREATE POLICY "Supervisors read tax reserve ledger" ON cash_tax_reserve_ledger
  FOR SELECT USING (is_supervisor(auth.uid()));

DROP POLICY IF EXISTS "System insert tax reserve ledger" ON cash_tax_reserve_ledger;
CREATE POLICY "System insert tax reserve ledger" ON cash_tax_reserve_ledger
  FOR INSERT WITH CHECK (true);

-- Inmutable: es un ledger contable, nunca se edita/borra una línea ya escrita.
DROP TRIGGER IF EXISTS trg_prevent_delete ON cash_tax_reserve_ledger;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON cash_tax_reserve_ledger
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

-- ============================================================
-- 2. Configuración del tope de exposición diaria.
--
-- NOTA HONESTA: el plan describe el tope como "% de caja", pero el sistema
-- hoy NO tiene una fuente de verdad del saldo bancario real (no hay
-- integración con el banco). Inventar ese número sería falso. Por eso el
-- tope se implementa como un monto ABSOLUTO configurable (cents) sobre los
-- Holds autorizados y aún no cobrados. Migrar a "% de caja" real requiere
-- primero una integración de saldo bancario — TODO explícito, no construido.
-- ============================================================
CREATE TABLE IF NOT EXISTS cash_exposure_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_exposure_cap_cents INTEGER NOT NULL CHECK (daily_exposure_cap_cents > 0),
  effective_from DATE NOT NULL DEFAULT now(),
  effective_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE cash_exposure_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Supervisors read cash exposure settings" ON cash_exposure_settings;
CREATE POLICY "Supervisors read cash exposure settings" ON cash_exposure_settings
  FOR SELECT USING (is_supervisor(auth.uid()));

DROP POLICY IF EXISTS "Supervisors manage cash exposure settings" ON cash_exposure_settings;
CREATE POLICY "Supervisors manage cash exposure settings" ON cash_exposure_settings
  FOR ALL USING (is_supervisor(auth.uid()));

-- Valor semilla conservador: $20,000 CAD. Es un placeholder editable por el
-- dueño (vía admin_update_config, exige motivo — B.2.10), no una cifra
-- validada contra caja real.
INSERT INTO cash_exposure_settings (daily_exposure_cap_cents, effective_from)
VALUES (2000000, now())
ON CONFLICT DO NOTHING;

-- Se conecta al mecanismo genérico de snapshot inmutable (migración 042).
DROP TRIGGER IF EXISTS trg_config_snapshot ON cash_exposure_settings;
CREATE TRIGGER trg_config_snapshot BEFORE UPDATE ON cash_exposure_settings
  FOR EACH ROW EXECUTE FUNCTION snapshot_config_update();

-- Se agrega cash_exposure_settings a la whitelist de admin_update_config
-- (migración 042). CREATE OR REPLACE, misma lógica, whitelist ampliada.
CREATE OR REPLACE FUNCTION admin_update_config(
  p_table TEXT,
  p_id UUID,
  p_changes JSONB,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_allowed TEXT[] := ARRAY[
    'feature_flags','pricing_settings','payroll_settings',
    'chargeback_settings','hhe_settings','cash_exposure_settings'
  ];
  v_set_clause TEXT;
  v_result JSONB;
BEGIN
  IF NOT has_admin_role(auth.uid(), ARRAY['owner_admin']) THEN
    RAISE EXCEPTION 'Solo owner_admin puede cambiar configuración';
  END IF;
  IF NOT (p_table = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'Tabla % no está en la whitelist de configuración', p_table;
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'El motivo del cambio es obligatorio (mínimo 3 caracteres)';
  END IF;

  PERFORM set_config('app.change_reason', p_reason, true);
  PERFORM set_config('app.change_user', auth.uid()::text, true);

  SELECT string_agg(format('%I = ($1->>%L)::%s', key, key,
           (SELECT format_type(a.atttypid, a.atttypmod)
            FROM pg_attribute a
            WHERE a.attrelid = p_table::regclass AND a.attname = key)), ', ')
    INTO v_set_clause
  FROM jsonb_object_keys(p_changes) AS key;

  IF v_set_clause IS NULL THEN
    RAISE EXCEPTION 'Sin cambios';
  END IF;

  EXECUTE format('UPDATE %I SET %s WHERE id = $2 RETURNING to_jsonb(%I.*)', p_table, v_set_clause, p_table)
    INTO v_result USING p_changes, p_id;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Fila % no encontrada en %', p_id, p_table;
  END IF;

  RETURN v_result;
END;
$$;

-- ============================================================
-- 3. Alertas de exposición (el cron cash-exposure-monitor inserta aquí).
-- ============================================================
CREATE TABLE IF NOT EXISTS cash_exposure_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_date DATE NOT NULL,
  pending_exposure_cents INTEGER NOT NULL,
  cap_cents INTEGER NOT NULL,
  exposure_ratio NUMERIC(6,4) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (alert_date)
);

ALTER TABLE cash_exposure_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Supervisors read cash exposure alerts" ON cash_exposure_alerts;
CREATE POLICY "Supervisors read cash exposure alerts" ON cash_exposure_alerts
  FOR SELECT USING (is_supervisor(auth.uid()));

DROP POLICY IF EXISTS "System insert cash exposure alerts" ON cash_exposure_alerts;
CREATE POLICY "System insert cash exposure alerts" ON cash_exposure_alerts
  FOR INSERT WITH CHECK (true);

-- ============================================================
-- 4. Feature flags (apagados por defecto — decisión pendiente del dueño)
-- ============================================================
INSERT INTO feature_flags (nombre, activo, modulo, descripcion)
VALUES
  ('cash_reserve_tracking_enabled', false, 'E2', 'Reserva virtual 12% GST+PST por cada cobro capturado'),
  ('cash_exposure_monitor_enabled', false, 'E2', 'Alerta de tope de exposición diaria (Holds pendientes sin cobrar)')
ON CONFLICT (nombre) DO UPDATE SET activo = false;

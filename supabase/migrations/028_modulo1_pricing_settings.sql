-- Migración Módulo 1 — Configuración de tarifa objetivo editable por admin
-- Cierra hallazgo de auditoría: la tarifa objetivo ($70/hr default) debe ser
-- editable por admin en un solo campo y recalcular las 20 celdas de la tabla HHE.

-- ============================================================
-- 1. Tabla de configuración de precios
-- ============================================================
CREATE TABLE IF NOT EXISTS pricing_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_hourly_rate NUMERIC(10,2) NOT NULL DEFAULT 70.00,
  effective_from DATE NOT NULL DEFAULT '2026-06-01',
  effective_to DATE,
  reason TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Solo puede haber una tarifa vigente a la vez; el código siempre usa la más reciente.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pricing_settings_current
  ON pricing_settings (effective_from)
  WHERE effective_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_pricing_settings_effective
  ON pricing_settings (effective_from, effective_to);

ALTER TABLE pricing_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Supervisors read pricing settings" ON pricing_settings;
CREATE POLICY "Supervisors read pricing settings" ON pricing_settings
  FOR SELECT USING (is_supervisor(auth.uid()));

DROP POLICY IF EXISTS "Supervisors manage pricing settings" ON pricing_settings;
CREATE POLICY "Supervisors manage pricing settings" ON pricing_settings
  FOR ALL USING (is_supervisor(auth.uid())) WITH CHECK (is_supervisor(auth.uid()));

-- Seed: tarifa objetivo inicial de $70.00/hr vigente desde 2026-06-01
INSERT INTO pricing_settings (target_hourly_rate, effective_from, reason)
VALUES (70.00, '2026-06-01', 'Tarifa objetivo inicial v8.2')
ON CONFLICT DO NOTHING;

-- ============================================================
-- 2. Audit log para cambios de tarifa
-- ============================================================
CREATE TABLE IF NOT EXISTS pricing_settings_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  previous_rate NUMERIC(10,2),
  new_rate NUMERIC(10,2) NOT NULL,
  previous_effective_from DATE,
  new_effective_from DATE NOT NULL,
  reason TEXT NOT NULL,
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pricing_settings_audit_created
  ON pricing_settings_audit_logs (created_at DESC);

ALTER TABLE pricing_settings_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Supervisors read pricing settings audit" ON pricing_settings_audit_logs;
CREATE POLICY "Supervisors read pricing settings audit" ON pricing_settings_audit_logs
  FOR SELECT USING (is_supervisor(auth.uid()));

DROP POLICY IF EXISTS "Supervisors insert pricing settings audit" ON pricing_settings_audit_logs;
CREATE POLICY "Supervisors insert pricing settings audit" ON pricing_settings_audit_logs
  FOR INSERT WITH CHECK (is_supervisor(auth.uid()));

-- ============================================================
-- 3. Función RPC para obtener tarifa vigente (usada por cron/edge functions)
-- ============================================================
CREATE OR REPLACE FUNCTION get_current_target_hourly_rate()
RETURNS NUMERIC(10,2)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT target_hourly_rate
     FROM pricing_settings
     WHERE effective_to IS NULL
     ORDER BY effective_from DESC
     LIMIT 1),
    70.00
  );
$$;

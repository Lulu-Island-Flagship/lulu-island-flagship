-- Migración 075 — v8.3 E2.8 / D.9 Doc 2: ajuste anual IPC de contratos
-- recurrentes al aniversario, con aviso de 30 días.
--
-- Mismo patrón que el ajuste anual de salario mínimo BC (invariante B.1:
-- "Es un EVENTO ANUAL GARANTIZADO programado como recurrente, nunca una
-- sorpresa"): el % de ajuste se deriva de payroll_settings (histórico de
-- bc_min_wage_hourly), reusando calculateMinimumWageImpact de
-- src/lib/economic-params.ts como fuente del deltaPercent (ver
-- src/lib/contract-ipc-adjustment.ts). No se inventa un índice IPC nuevo.
--
-- A diferencia del cambio de salario mínimo (B.3.2, exige UN clic humano
-- porque es un cambio LEGAL con impacto en nómina), el ajuste IPC de un
-- contrato recurrente al aniversario NO está en la lista de los 6 puntos
-- de intervención humana obligatoria (B.3) — es un evento contractual ya
-- pactado con el cliente (D.9 Doc 2: "ajuste IPC anual con 30 días de
-- aviso"). Por eso se aplica automáticamente, con snapshot inmutable.

-- ============================================================
-- 1. Campos de tracking en service_contracts
-- ============================================================
ALTER TABLE service_contracts
  ADD COLUMN IF NOT EXISTS last_ipc_adjustment_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_ipc_notice_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_ipc_notice_year INTEGER,
  ADD COLUMN IF NOT EXISTS last_ipc_adjustment_year INTEGER;

-- ============================================================
-- 2. Registro inmutable de cada ajuste aplicado (snapshot dedicado,
-- análogo a config_snapshots pero para un evento de negocio recurrente,
-- no una edición manual de admin — no requiere motivo humano).
-- ============================================================
CREATE TABLE IF NOT EXISTS contract_ipc_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES service_contracts(id) ON DELETE CASCADE,
  adjustment_year INTEGER NOT NULL,
  ipc_percentage NUMERIC(6,3) NOT NULL,
  previous_base_price INTEGER NOT NULL,
  previous_total INTEGER NOT NULL,
  new_base_price INTEGER NOT NULL,
  new_total INTEGER NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contract_id, adjustment_year)
);

CREATE INDEX IF NOT EXISTS idx_contract_ipc_adjustments_contract ON contract_ipc_adjustments(contract_id);

ALTER TABLE contract_ipc_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Clients read own contract IPC adjustments" ON contract_ipc_adjustments;
CREATE POLICY "Clients read own contract IPC adjustments" ON contract_ipc_adjustments
  FOR SELECT USING (
    contract_id IN (SELECT id FROM service_contracts WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Supervisors read all contract IPC adjustments" ON contract_ipc_adjustments;
CREATE POLICY "Supervisors read all contract IPC adjustments" ON contract_ipc_adjustments
  FOR SELECT USING (is_supervisor(auth.uid()));

DROP POLICY IF EXISTS "System insert contract IPC adjustments" ON contract_ipc_adjustments;
CREATE POLICY "System insert contract IPC adjustments" ON contract_ipc_adjustments
  FOR INSERT WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_prevent_delete ON contract_ipc_adjustments;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON contract_ipc_adjustments
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

-- ============================================================
-- 3. Registro del aviso de 30 días (D.9 Doc 2), separado del ajuste real.
-- ============================================================
CREATE TABLE IF NOT EXISTS contract_ipc_notices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES service_contracts(id) ON DELETE CASCADE,
  adjustment_year INTEGER NOT NULL,
  ipc_percentage NUMERIC(6,3) NOT NULL,
  projected_new_base_price INTEGER NOT NULL,
  projected_new_total INTEGER NOT NULL,
  anniversary_date DATE NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contract_id, adjustment_year)
);

ALTER TABLE contract_ipc_notices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Clients read own contract IPC notices" ON contract_ipc_notices;
CREATE POLICY "Clients read own contract IPC notices" ON contract_ipc_notices
  FOR SELECT USING (
    contract_id IN (SELECT id FROM service_contracts WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Supervisors read all contract IPC notices" ON contract_ipc_notices;
CREATE POLICY "Supervisors read all contract IPC notices" ON contract_ipc_notices
  FOR SELECT USING (is_supervisor(auth.uid()));

DROP POLICY IF EXISTS "System insert contract IPC notices" ON contract_ipc_notices;
CREATE POLICY "System insert contract IPC notices" ON contract_ipc_notices
  FOR INSERT WITH CHECK (true);

-- ============================================================
-- 4. Feature flag (apagado por defecto — decisión pendiente del dueño)
-- ============================================================
INSERT INTO feature_flags (nombre, activo, modulo, descripcion)
VALUES ('recurring_contract_ipc_enabled', false, 'E2', 'Ajuste IPC anual de contratos recurrentes al aniversario, con aviso 30 días')
ON CONFLICT (nombre) DO UPDATE SET activo = false;

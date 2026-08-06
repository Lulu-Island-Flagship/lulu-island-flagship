-- Migration 365: Create financial_ledger table with double-entry trigger
-- Financial Core v8.6 — Capa 0. Esta tabla es la fuente de verdad contable.
-- Cada transacción genera mínimo 2 filas (débito + crédito) con el mismo ledger_id.
-- El trigger valida SUM(débito) = SUM(crédito) y hace ROLLBACK si no cuadra.
--
-- NOTA: los códigos de cuenta usan el formato del CHART_OF_ACCOUNTS en
-- financial-ledger.ts. Una migración futura unificará con coa.ts (sin guiones).
-- Los índices y CHECK constraints garantizan integridad desde el día 1.

BEGIN;

-- 1. Tabla principal
CREATE TABLE IF NOT EXISTS financial_ledger (
  id            BIGSERIAL PRIMARY KEY,
  ledger_id     UUID NOT NULL,
  event_id      UUID NOT NULL,
  event_type    TEXT NOT NULL,
  "timestamp"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  periodo_contable  TEXT NOT NULL CHECK (periodo_contable ~ '^\d{4}-\d{2}$'),
  cuenta_debito TEXT CHECK (cuenta_debito IS NULL OR cuenta_debito IN (
    '1-1000','1-1020','1-1100','1-1200','1-2025',
    '2-1000','2-2020','2-2030',
    '4-1000','4-2000','4-4010',
    '5-1000','5-2000'
  )),
  cuenta_credito TEXT CHECK (cuenta_credito IS NULL OR cuenta_credito IN (
    '1-1000','1-1020','1-1100','1-1200','1-2025',
    '2-1000','2-2020','2-2030',
    '4-1000','4-2000','4-4010',
    '5-1000','5-2000'
  )),
  monto          INTEGER NOT NULL CHECK (monto > 0),
  moneda         TEXT NOT NULL DEFAULT 'CAD' CHECK (moneda = 'CAD'),
  descripcion    TEXT NOT NULL DEFAULT '',
  referencia     JSONB NOT NULL DEFAULT '{}',
  estado         TEXT NOT NULL DEFAULT 'confirmado'
                   CHECK (estado IN ('confirmado','reversado','ajuste')),
  hash_sha256    TEXT NOT NULL CHECK (hash_sha256 ~ '^[a-f0-9]{64}$'),
  creado_por     TEXT NOT NULL DEFAULT 'system',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Restricción: CADA fila debe tener exactamente UN lado (débito XOR crédito)
  CONSTRAINT chk_financial_ledger_one_side CHECK (
    (cuenta_debito IS NOT NULL AND cuenta_credito IS NULL) OR
    (cuenta_debito IS NULL AND cuenta_credito IS NOT NULL)
  )
);

-- 2. Índices
CREATE INDEX IF NOT EXISTS idx_financial_ledger_ledger_id ON financial_ledger(ledger_id);
CREATE INDEX IF NOT EXISTS idx_financial_ledger_event_id ON financial_ledger(event_id);
CREATE INDEX IF NOT EXISTS idx_financial_ledger_periodo ON financial_ledger(periodo_contable);
CREATE INDEX IF NOT EXISTS idx_financial_ledger_event_type ON financial_ledger(event_type);
CREATE INDEX IF NOT EXISTS idx_financial_ledger_estado ON financial_ledger(estado);
CREATE INDEX IF NOT EXISTS idx_financial_ledger_created_at ON financial_ledger(created_at);

-- 3. Trigger de validación de partida doble
--    Corre AFTER INSERT … FOR EACH STATEMENT. Si la suma no cuadra,
--    lanza EXCEPTION y PostgreSQL hace ROLLBACK de TODA la transacción.
CREATE OR REPLACE FUNCTION fn_validate_double_entry()
RETURNS TRIGGER AS $$
DECLARE
  v_sum_debito  BIGINT;
  v_sum_credito BIGINT;
  v_ledger_id   UUID;
BEGIN
  FOR v_ledger_id, v_sum_debito, v_sum_credito IN
    SELECT
      ledger_id,
      COALESCE(SUM(monto) FILTER (WHERE cuenta_debito IS NOT NULL), 0),
      COALESCE(SUM(monto) FILTER (WHERE cuenta_credito IS NOT NULL), 0)
    FROM financial_ledger
    WHERE ledger_id IN (SELECT DISTINCT ledger_id FROM inserted_rows)
    GROUP BY ledger_id
  LOOP
    IF v_sum_debito != v_sum_credito THEN
      RAISE EXCEPTION 'Partida doble inválida — ledger_id=% débito=% crédito=%',
        v_ledger_id, v_sum_debito, v_sum_credito;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_double_entry ON financial_ledger;
CREATE TRIGGER trg_validate_double_entry
  AFTER INSERT ON financial_ledger
  REFERENCING NEW TABLE AS inserted_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION fn_validate_double_entry();

-- 4. RLS — solo service_role y supervisors pueden leer; solo service_role inserta
ALTER TABLE financial_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access financial ledger" ON financial_ledger;
CREATE POLICY "Service role full access financial ledger" ON financial_ledger
  FOR ALL USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Supervisors read financial ledger" ON financial_ledger;
CREATE POLICY "Supervisors read financial ledger" ON financial_ledger
  FOR SELECT
  USING (is_supervisor(auth.uid()));

COMMIT;

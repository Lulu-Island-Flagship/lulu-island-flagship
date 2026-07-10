-- Migración 088 — v8.3 E7: conecta property_risk_assessments al flujo de
-- cotización/reserva. Antes de esta migración, evaluatePropertyRisk se
-- calculaba y se guardaba pero NUNCA se consultaba al cotizar/reservar
-- (cero referencias fuera de src/lib/property-risk.ts y su propio endpoint
-- admin). Ver src/lib/property-risk.ts::evaluateBookingRiskConsequence.
--
-- Dueño del módulo: E7 (riesgo). Lee: E1 (cotizador/reserva), E3 (despacho,
-- vía requires_field_auditor / property_risk_tier en orders).

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS client_property_id UUID REFERENCES client_properties(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS requires_field_auditor BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS property_risk_tier TEXT NOT NULL DEFAULT 'standard'
    CHECK (property_risk_tier IN ('standard', 'auditor_required', 'pre_inspection_required'));

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS client_property_id UUID REFERENCES client_properties(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS requires_field_auditor BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS property_risk_tier TEXT NOT NULL DEFAULT 'standard'
    CHECK (property_risk_tier IN ('standard', 'auditor_required', 'pre_inspection_required'));

CREATE INDEX IF NOT EXISTS idx_quotes_client_property ON quotes(client_property_id);
CREATE INDEX IF NOT EXISTS idx_orders_client_property ON orders(client_property_id);

COMMENT ON COLUMN quotes.property_risk_tier IS
  'v8.3 E7: snapshot del tier de riesgo vigente al cotizar (property_risk_assessments). Invisible al cliente — ver client-visible-columns.ts.';
COMMENT ON COLUMN orders.property_risk_tier IS
  'v8.3 E7: snapshot sellado al reservar (B.2.11: orden reservada = precio y contexto sellados). Invisible al cliente.';

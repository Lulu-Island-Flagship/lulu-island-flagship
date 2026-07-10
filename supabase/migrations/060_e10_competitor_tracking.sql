-- Migración 060 — v8.3 E10 (D.10.10): estructura de inteligencia competitiva.
-- SOLO estructura + lógica de alerta (competitor-tracking.ts). NO hay
-- scraping real todavía (⏸️ diferido, B.4: requiere revisar TOS de cada
-- sitio externo antes de automatizarlo). Los datos llegan hoy por el
-- checklist manual mensual de E1; `source` distingue el origen pero ambos
-- alimentan la misma tabla (criterio de aceptación E10: no romper el panel
-- manual existente).

-- ============================================================
-- 1. Competidores rastreados (tope 10 activos — enforced en la capa de
--    aplicación via canAddCompetitor(), no aquí, porque contar "activos"
--    requiere lógica de negocio que ya vive en TS; un CHECK a nivel fila no
--    puede contar filas hermanas).
-- ============================================================
CREATE TABLE IF NOT EXISTS competitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  zone TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_competitors_active ON competitors(zone) WHERE deleted_at IS NULL;

ALTER TABLE competitors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins manage competitors" ON competitors;
CREATE POLICY "admins manage competitors" ON competitors
  FOR ALL USING (has_admin_role(auth.uid(), ARRAY['owner_admin','ops_coordinator']))
  WITH CHECK (has_admin_role(auth.uid(), ARRAY['owner_admin','ops_coordinator']));

DROP TRIGGER IF EXISTS trg_prevent_delete ON competitors;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON competitors
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

-- ============================================================
-- 2. Historial de precio/servicios/reputación por competidor. Una fila por
--    captura (manual o scraping futuro) — nunca se sobreescribe, es
--    historial (spec: "historial de precio").
-- ============================================================
CREATE TABLE IF NOT EXISTS competitor_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id UUID NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL CHECK (source IN ('manual_checklist', 'scraping')),
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  services JSONB NOT NULL DEFAULT '[]'::jsonb,
  active_promotions JSONB NOT NULL DEFAULT '[]'::jsonb,
  average_rating NUMERIC(2,1) CHECK (average_rating >= 0 AND average_rating <= 5),
  review_count INTEGER NOT NULL DEFAULT 0 CHECK (review_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_competitor_snapshots_history
  ON competitor_snapshots(competitor_id, captured_at DESC);

ALTER TABLE competitor_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins manage competitor snapshots" ON competitor_snapshots;
CREATE POLICY "admins manage competitor snapshots" ON competitor_snapshots
  FOR ALL USING (has_admin_role(auth.uid(), ARRAY['owner_admin','ops_coordinator']))
  WITH CHECK (has_admin_role(auth.uid(), ARRAY['owner_admin','ops_coordinator']));

-- Snapshots son historial inmutable: nunca DELETE, solo INSERT (no llevan
-- deleted_at a propósito — son evidencia histórica, no una entidad activa
-- que se pueda desactivar).
DROP TRIGGER IF EXISTS trg_prevent_delete ON competitor_snapshots;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON competitor_snapshots
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

-- ============================================================
-- 3. Alertas generadas por detectCompetitorAlerts() (competitor-tracking.ts).
--    Log de lo que el sistema detectó, para el dashboard comparativo.
-- ============================================================
CREATE TABLE IF NOT EXISTS competitor_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id UUID NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('price_change', 'new_competitor', 'reputation_opportunity')),
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning')),
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_competitor_alerts_unacknowledged
  ON competitor_alerts(created_at) WHERE acknowledged_at IS NULL;

ALTER TABLE competitor_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins manage competitor alerts" ON competitor_alerts;
CREATE POLICY "admins manage competitor alerts" ON competitor_alerts
  FOR ALL USING (has_admin_role(auth.uid(), ARRAY['owner_admin','ops_coordinator']))
  WITH CHECK (has_admin_role(auth.uid(), ARRAY['owner_admin','ops_coordinator']));

DROP TRIGGER IF EXISTS trg_prevent_delete ON competitor_alerts;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON competitor_alerts
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

COMMENT ON TABLE competitors IS
  'v8.3 E10: hasta 10 competidores activos (tope enforced en competitor-tracking.ts::canAddCompetitor). Fuente manual hoy, scraping futuro (mismo esquema).';
COMMENT ON TABLE competitor_snapshots IS
  'v8.3 E10: historial inmutable de precio/servicios/reputación por competidor. Alimenta detectCompetitorAlerts() y benchmarkZoneReputation().';

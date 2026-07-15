-- Migración 141 — v8.3 E10 (D.10.4): conecta el catálogo de 5 campañas
-- estacionales a datos reales.
--
-- Contexto (auditoría 2026-07-14): src/lib/demand-signals.ts ya tenía
-- decideCampaignTrigger() + calculateDemandMultiplier() como funciones
-- puras, con los 5 multiplicadores literales del spec y los 5 nombres de
-- campaña (SeasonalCampaign), y ya venían probadas (demand-signals.test.ts).
-- Pero ninguna ruta ni tabla las usaba -- exactamente el mismo patrón de
-- "lógica correcta, huérfana" ya visto en zone-assignment (E4) y
-- warranty-dispute-resolution (E5).
--
-- Diseño: catálogo fijo de 5 filas (seed) + bitácora de evaluaciones/año.
-- La fecha sugerida es UN mes (D.10.4: "la fecha es sugerencia"), no un día
-- exacto -- el disparo real lo decide la demanda observada o, en su
-- defecto, que ya se haya alcanzado el mes sugerido.

CREATE TABLE IF NOT EXISTS seasonal_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_key TEXT NOT NULL UNIQUE
    CHECK (campaign_key IN ('spring_refresh', 'summer_prep', 'back_to_routine', 'holiday_ready', 'post_holiday_reset')),
  display_name TEXT NOT NULL,
  suggested_month INTEGER NOT NULL CHECK (suggested_month BETWEEN 1 AND 12),
  description TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE seasonal_campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins read seasonal campaigns" ON seasonal_campaigns;
CREATE POLICY "admins read seasonal campaigns" ON seasonal_campaigns
  FOR SELECT USING (has_admin_role(auth.uid(), ARRAY['owner_admin','ops_coordinator']));
DROP POLICY IF EXISTS "owner_admin manages seasonal campaigns" ON seasonal_campaigns;
CREATE POLICY "owner_admin manages seasonal campaigns" ON seasonal_campaigns
  FOR ALL USING (has_admin_role(auth.uid(), ARRAY['owner_admin']))
  WITH CHECK (has_admin_role(auth.uid(), ARRAY['owner_admin']));

INSERT INTO seasonal_campaigns (campaign_key, display_name, suggested_month, description) VALUES
  ('spring_refresh', 'Spring Refresh', 3, 'Post-winter deep clean push -- highest-intent seasonal window.'),
  ('summer_prep', 'Summer Prep', 5, 'Pre-summer / hosting-season readiness.'),
  ('back_to_routine', 'Back to Routine', 9, 'Post-summer return to recurring service after back-to-school.'),
  ('holiday_ready', 'Holiday Ready', 11, 'Pre-holiday deep clean before hosting season.'),
  ('post_holiday_reset', 'Post-Holiday Reset', 1, 'January reset after holiday wear and guests.')
ON CONFLICT (campaign_key) DO NOTHING;

-- ============================================================
-- Bitácora de evaluaciones. Una fila por (campaña, año): registra las
-- señales de demanda evaluadas, el multiplicador resultante, si el motor
-- pide disparar, y la decisión humana (aprobación de un toque, D.10.4).
-- No permite dos evaluaciones "pending" simultáneas para la misma
-- campaña+año -- una nueva evaluación reemplaza (no duplica) la anterior
-- mientras siga pendiente.
-- ============================================================
CREATE TABLE IF NOT EXISTS seasonal_campaign_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_key TEXT NOT NULL REFERENCES seasonal_campaigns(campaign_key),
  campaign_year INTEGER NOT NULL CHECK (campaign_year >= 2026),
  signals JSONB NOT NULL DEFAULT '{}',
  applied_factors TEXT[] NOT NULL DEFAULT '{}',
  multiplier NUMERIC(4,2) NOT NULL,
  should_trigger BOOLEAN NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'suggested'
    CHECK (status IN ('suggested', 'approved', 'rejected', 'dispatched')),
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_seasonal_campaign_runs_pending
  ON seasonal_campaign_runs (campaign_key, campaign_year)
  WHERE status = 'suggested' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_seasonal_campaign_runs_status
  ON seasonal_campaign_runs (status) WHERE deleted_at IS NULL;

ALTER TABLE seasonal_campaign_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins manage seasonal campaign runs" ON seasonal_campaign_runs;
CREATE POLICY "admins manage seasonal campaign runs" ON seasonal_campaign_runs
  FOR ALL USING (has_admin_role(auth.uid(), ARRAY['owner_admin','ops_coordinator']))
  WITH CHECK (has_admin_role(auth.uid(), ARRAY['owner_admin','ops_coordinator']));

DROP TRIGGER IF EXISTS trg_prevent_delete ON seasonal_campaign_runs;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON seasonal_campaign_runs
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

COMMENT ON TABLE seasonal_campaign_runs IS
  'v8.3 E10/D.10.4: bitácora de evaluación+aprobación de las 5 campañas estacionales. La decisión de disparo la calcula decideCampaignTrigger() (demand-signals.ts, función pura ya probada); esta tabla es donde por fin se usa.';

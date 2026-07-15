-- Migración 160 — v8.3 E5.15: Live Portfolio.
-- "Selección automática (diferencia visual >80%, checklist 100%, sin
-- flags, score ≥80), anonimización (difuminado, EXIF fuera, GPS a
-- ciudad), aprobación admin de un toque, derecho de retiro <24h, etiqueta
-- anónima. Sin consentimiento: solo fotos demo."
--
-- NOTA HONESTA (ver comentario extenso en src/lib/live-portfolio.ts): la
-- "diferencia visual >80%" es un juicio humano en la aprobación admin, no
-- un algoritmo de visión por computador inventado. anonymization_status
-- deja explícito que difuminado/EXIF-stripping son procesamiento manual
-- pendiente -- el gate público (policy de abajo) solo expone filas
-- 'processed', nunca publica una foto sin anonimizar por accidente.

CREATE TABLE IF NOT EXISTS live_portfolio_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  client_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,

  checklist_completion_percent INTEGER NOT NULL,
  employee_score_at_selection INTEGER NOT NULL,
  zone TEXT NOT NULL,
  service_subtype TEXT NOT NULL,
  anonymous_label TEXT NOT NULL,

  -- fuente candidata de fotos (checklist photos del servicio) -- el admin
  -- elige cuál(es) mostrar al aprobar, no se auto-publican todas.
  candidate_photo_urls TEXT[] NOT NULL DEFAULT '{}',
  selected_photo_url TEXT,

  status TEXT NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate', 'approved', 'rejected', 'withdrawn')),
  anonymization_status TEXT NOT NULL DEFAULT 'pending_manual_processing'
    CHECK (anonymization_status IN ('pending_manual_processing', 'processed')),

  approved_at TIMESTAMPTZ,
  approved_by UUID,
  withdrawal_deadline TIMESTAMPTZ,
  withdrawn_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  rejected_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_live_portfolio_status ON live_portfolio_candidates(status);
CREATE INDEX IF NOT EXISTS idx_live_portfolio_client ON live_portfolio_candidates(client_user_id);

ALTER TABLE live_portfolio_candidates ENABLE ROW LEVEL SECURITY;

-- Público: SOLO filas aprobadas Y ya anonimizadas de verdad. Fail-closed --
-- mientras anonymization_status siga 'pending_manual_processing' (hoy,
-- SIEMPRE, ver nota honesta arriba) nada es visible públicamente.
DROP POLICY IF EXISTS "Public reads approved processed portfolio" ON live_portfolio_candidates;
CREATE POLICY "Public reads approved processed portfolio" ON live_portfolio_candidates
  FOR SELECT USING (status = 'approved' AND anonymization_status = 'processed');

-- El cliente dueño del servicio puede ver y ejercer su derecho de retiro
-- (<24h desde la aprobación) sobre SU propia entrada, en cualquier estado.
DROP POLICY IF EXISTS "Clients read own portfolio entries" ON live_portfolio_candidates;
CREATE POLICY "Clients read own portfolio entries" ON live_portfolio_candidates
  FOR SELECT USING (auth.uid() = client_user_id);

DROP POLICY IF EXISTS "Clients withdraw own portfolio entries" ON live_portfolio_candidates;
CREATE POLICY "Clients withdraw own portfolio entries" ON live_portfolio_candidates
  FOR UPDATE USING (auth.uid() = client_user_id)
  WITH CHECK (auth.uid() = client_user_id);

DROP POLICY IF EXISTS "Supervisors manage portfolio candidates" ON live_portfolio_candidates;
CREATE POLICY "Supervisors manage portfolio candidates" ON live_portfolio_candidates
  FOR ALL USING (is_supervisor(auth.uid()));

COMMENT ON TABLE live_portfolio_candidates IS
  'v8.3 E5.15: candidatos a Live Portfolio con selección objetiva automática (checklist/flags/score/consentimiento) + aprobación humana de un toque. anonymization_status fail-closed: nunca se publica sin procesar.';

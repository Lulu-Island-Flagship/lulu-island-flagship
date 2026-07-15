-- Migración 149 — v8.3 E5: anti-gaming de votación entre pares. La lógica
-- pura (src/lib/peer-vote-integrity.ts: detectReciprocalHighRatings,
-- hasSufficientVoterSample — 100% testeada) existía sin ningún cron que la
-- llamara: recalculate_weekly_score (RPC SQL) computaba peer_score crudo sin
-- detectar colusión recíproca ni exigir muestra mínima de votantes.

CREATE TABLE IF NOT EXISTS peer_vote_collusion_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start DATE NOT NULL,
  employee_a UUID NOT NULL REFERENCES employees(id),
  employee_b UUID NOT NULL REFERENCES employees(id),
  rating_a_to_b INTEGER NOT NULL,
  rating_b_to_a INTEGER NOT NULL,
  reviewed BOOLEAN NOT NULL DEFAULT false,
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_peer_collusion_week ON peer_vote_collusion_flags(week_start);
CREATE INDEX IF NOT EXISTS idx_peer_collusion_reviewed ON peer_vote_collusion_flags(reviewed);

ALTER TABLE peer_vote_collusion_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Supervisors manage collusion flags" ON peer_vote_collusion_flags;
CREATE POLICY "Supervisors manage collusion flags" ON peer_vote_collusion_flags
  FOR ALL USING (is_supervisor(auth.uid())) WITH CHECK (is_supervisor(auth.uid()));

DROP TRIGGER IF EXISTS trg_prevent_delete ON peer_vote_collusion_flags;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON peer_vote_collusion_flags
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

COMMENT ON TABLE peer_vote_collusion_flags IS
  'v8.3 E5: pares marcados por detectReciprocalHighRatings (src/lib/peer-vote-integrity.ts) para revisión humana -- no descarta el voto automáticamente, solo lo señala.';

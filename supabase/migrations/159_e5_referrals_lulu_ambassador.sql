-- Migración 159 — v8.3 E5.13: Referidos "Lulu Ambassador".
-- "VIP (>5 servicios, score >80) → código único → $30 crédito ambos; +$5 al
-- líder si lo mencionan. Anti-fraude: misma IP flag; mismo referido con 3
-- códigos = ban temporal."

-- ============================================================
-- 1. Código propio del referente (VIP). Generado bajo demanda (lazy) por
--    GET /api/client/referral -- solo si el cliente cumple los umbrales.
-- ============================================================
ALTER TABLE client_profiles
  ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS referred_by_code TEXT,
  ADD COLUMN IF NOT EXISTS referral_signup_ip TEXT,
  ADD COLUMN IF NOT EXISTS referral_credited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS referral_banned_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_client_profiles_referral_code ON client_profiles(referral_code);
CREATE INDEX IF NOT EXISTS idx_client_profiles_referred_by_code ON client_profiles(referred_by_code);

COMMENT ON COLUMN client_profiles.referred_by_code IS
  'Código de referido usado al registrarse. Inmutable una vez asignado (se aplica en la ruta, no aquí) -- evita "code shopping" retroactivo.';
COMMENT ON COLUMN client_profiles.referral_banned_until IS
  'v8.3 E5.13 anti-fraude: si no es NULL y está en el futuro, este cliente no puede canjear NINGÚN código de referido (intentó 3+ códigos distintos).';

-- ============================================================
-- 2. Bitácora de INTENTOS de canje (no solo los exitosos) -- necesaria para
--    detectar "mismo referido con 3 códigos" incluso si los primeros
--    intentos fueron rechazados por otro motivo.
-- ============================================================
CREATE TABLE IF NOT EXISTS referral_redemption_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referred_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  ip_address TEXT,
  result TEXT NOT NULL CHECK (result IN ('accepted', 'rejected_invalid_code', 'rejected_self', 'rejected_already_referred', 'rejected_banned')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referral_attempts_user ON referral_redemption_attempts(referred_user_id, created_at DESC);

ALTER TABLE referral_redemption_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Supervisors read referral attempts" ON referral_redemption_attempts;
CREATE POLICY "Supervisors read referral attempts" ON referral_redemption_attempts
  FOR SELECT USING (is_supervisor(auth.uid()));

-- ============================================================
-- 3. Referidos concretados: uno por par (referrer, referred). El crédito de
--    $30/$30 y el bono de $5 del líder se otorgan cuando la PRIMERA orden
--    del referido pasa a 'completed' (cron referral-credit-grant) -- nunca
--    en el signup, para no pagar por registros sin servicio real.
-- ============================================================
CREATE TABLE IF NOT EXISTS referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referred_user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  referrer_signup_ip TEXT,
  referred_signup_ip TEXT,
  same_ip_flag BOOLEAN NOT NULL DEFAULT false,
  mentioned_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'credited', 'flagged')),
  credited_at TIMESTAMPTZ,
  first_order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_status ON referrals(status);

ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own referrals as referrer" ON referrals;
CREATE POLICY "Users read own referrals as referrer" ON referrals
  FOR SELECT USING (auth.uid() = referrer_user_id);

DROP POLICY IF EXISTS "Supervisors read all referrals" ON referrals;
CREATE POLICY "Supervisors read all referrals" ON referrals
  FOR SELECT USING (is_supervisor(auth.uid()));

COMMENT ON COLUMN referrals.same_ip_flag IS
  'v8.3 E5.13 anti-fraude: TRUE si referente y referido comparten IP de signup. NO bloquea automáticamente el crédito -- lo marca para revisión humana (status queda flagged en vez de auto-creditar), evitando falsos positivos de hogares compartidos (B.3.4: el humano decide consecuencias serias).';

-- ============================================================
-- 4. Bono del líder mencionado -- mismo patrón exacto que
--    employee_badge_bonuses (migración 136), para que payroll-export lo
--    funda al mismo ciclo ya probado.
-- ============================================================
CREATE TABLE IF NOT EXISTS employee_referral_bonuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  referral_id UUID NOT NULL REFERENCES referrals(id) ON DELETE CASCADE,
  bonus_cents INTEGER NOT NULL CHECK (bonus_cents >= 0),
  credit_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_employee_referral_bonuses_employee ON employee_referral_bonuses(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_referral_bonuses_credit_date ON employee_referral_bonuses(credit_date);

ALTER TABLE employee_referral_bonuses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_admin manages referral bonuses" ON employee_referral_bonuses;
CREATE POLICY "owner_admin manages referral bonuses" ON employee_referral_bonuses
  FOR ALL USING (has_admin_role(auth.uid(), ARRAY['owner_admin']))
  WITH CHECK (has_admin_role(auth.uid(), ARRAY['owner_admin']));

DROP POLICY IF EXISTS "Employees read own referral bonuses" ON employee_referral_bonuses;
CREATE POLICY "Employees read own referral bonuses" ON employee_referral_bonuses
  FOR SELECT USING (employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid()));

COMMENT ON TABLE employee_referral_bonuses IS
  'v8.3 E5.13: bono de $5 al líder mencionado por el cliente referido. Espejo de employee_badge_bonuses -- se funde en payroll-export con baseAmountCents=0.';

-- ============================================================
-- 5. Catálogo de comunicaciones: aviso de crédito otorgado.
-- ============================================================
INSERT INTO communication_events (event_key, description, category, priority, default_channel) VALUES
  ('referral_credited', 'Crédito de $30 otorgado por programa de referidos Lulu Ambassador', 'transactional', 'normal', 'sms')
ON CONFLICT (event_key) DO NOTHING;

INSERT INTO communication_templates (event_key, language, version, body) VALUES
  ('referral_credited', 'en', 1,
    'Great news, {client_name}! We added $30 to your Lulu Wallet -- your referral just completed their first service. Thank you for spreading the word!'),
  ('referral_credited', 'es', 1,
    '¡Buenas noticias, {client_name}! Agregamos $30 a su Lulu Wallet -- su referido acaba de completar su primer servicio. ¡Gracias por recomendarnos!')
ON CONFLICT (event_key, language, version) DO NOTHING;

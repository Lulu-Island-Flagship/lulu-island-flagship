-- Migración Módulo 2 — Billetera Lulu y pago fraccionado

-- ============================================================
-- 1. Tabla de billetera por cliente
-- ============================================================
CREATE TABLE IF NOT EXISTS client_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  currency TEXT NOT NULL DEFAULT 'CAD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE client_wallets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Clients read own wallet" ON client_wallets;
CREATE POLICY "Clients read own wallet" ON client_wallets
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Supervisors read all wallets" ON client_wallets;
CREATE POLICY "Supervisors read all wallets" ON client_wallets
  FOR SELECT USING (is_supervisor(auth.uid()));

-- ============================================================
-- 2. Tabla de transacciones de billetera
-- ============================================================
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES client_wallets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  type TEXT NOT NULL
    CHECK (type IN ('credit', 'debit', 'refund', 'promo', 'payout')),
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_wallet ON wallet_transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user ON wallet_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_order ON wallet_transactions(order_id);

ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Clients read own wallet transactions" ON wallet_transactions;
CREATE POLICY "Clients read own wallet transactions" ON wallet_transactions
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Supervisors read all wallet transactions" ON wallet_transactions;
CREATE POLICY "Supervisors read all wallet transactions" ON wallet_transactions
  FOR SELECT USING (is_supervisor(auth.uid()));

DROP POLICY IF EXISTS "System insert wallet transactions" ON wallet_transactions;
CREATE POLICY "System insert wallet transactions" ON wallet_transactions
  FOR INSERT WITH CHECK (true);

-- ============================================================
-- 3. Extender orders para split payment
-- ============================================================
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS wallet_amount_used INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS card_amount_charged INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_paid INTEGER NOT NULL DEFAULT 0;

-- ============================================================
-- 4. Trigger: asegurar balance no negativo y crear wallet si no existe
-- ============================================================
CREATE OR REPLACE FUNCTION ensure_client_wallet()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO client_wallets (user_id, balance)
  VALUES (NEW.user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Aplicar trigger a client_profiles para crear wallet automáticamente
DROP TRIGGER IF EXISTS create_wallet_on_client_profile ON client_profiles;
CREATE TRIGGER create_wallet_on_client_profile
  AFTER INSERT ON client_profiles
  FOR EACH ROW
  EXECUTE FUNCTION ensure_client_wallet();

-- ============================================================
-- 5. Feature flag
-- ============================================================
INSERT INTO feature_flags (nombre, activo, modulo, descripcion)
VALUES ('lulu_wallet_enabled', false, 'Módulo 2', 'Billetera Lulu y pago fraccionado')
ON CONFLICT (nombre) DO UPDATE SET activo = false;

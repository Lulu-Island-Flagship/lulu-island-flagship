-- Migración: Políticas RLS faltantes para INSERT/UPDATE en quotes y orders.
-- El Módulo 1 crea cotizaciones y el Módulo 2 crea órdenes desde APIs server-side
-- usando el cliente autenticado del usuario. Sin estas políticas, RLS bloquea
-- las operaciones de escritura aunque el user_id sea el del usuario autenticado.

-- ============================================================
-- 0. Extensión de client_profiles para tokenización Stripe
-- ============================================================
ALTER TABLE client_profiles
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

-- ============================================================
-- 1. quotes: usuarios propios pueden insertar y actualizar
-- ============================================================
DROP POLICY IF EXISTS "Users insert own quotes" ON quotes;
CREATE POLICY "Users insert own quotes" ON quotes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own quotes" ON quotes;
CREATE POLICY "Users update own quotes" ON quotes
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 2. orders: usuarios propios pueden insertar y actualizar
-- ============================================================
DROP POLICY IF EXISTS "Users insert own orders" ON orders;
CREATE POLICY "Users insert own orders" ON orders
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own orders" ON orders;
CREATE POLICY "Users update own orders" ON orders
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 3. Prevenir órdenes duplicadas por quote (doble-submit)
-- ============================================================
-- (ADD CONSTRAINT no soporta IF NOT EXISTS en PostgreSQL — patrón idempotente con DO)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_quote_id_unique'
  ) THEN
    ALTER TABLE orders ADD CONSTRAINT "orders_quote_id_unique" UNIQUE (quote_id);
  END IF;
END $$;

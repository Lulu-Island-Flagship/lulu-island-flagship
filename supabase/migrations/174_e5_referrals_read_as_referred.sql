-- Migración 174 — RLS de `referrals` (migración 159) solo dejaba leer al
-- REFERRER ("Users read own referrals as referrer"). El panel de
-- beneficios del checkout (/api/client/checkout-benefits) necesita que el
-- usuario REFERIDO también pueda ver su propia fila (para mostrar
-- "crédito de referido pendiente") -- sin esta política, la consulta
-- simplemente no devuelve filas (RLS filtra en silencio, no da error),
-- así que el aviso nunca aparecería aunque el crédito exista de verdad.

DROP POLICY IF EXISTS "Users read own referrals as referred" ON referrals;
CREATE POLICY "Users read own referrals as referred" ON referrals
  FOR SELECT USING (auth.uid() = referred_user_id);

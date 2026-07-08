-- Políticas RLS faltantes para client_profiles.
-- Necesarias para que el cotizador cree/actualice el perfil del cliente autenticado
-- (score progresivo, tipo de cuenta B2B, etc.).

DROP POLICY IF EXISTS "Users insert own client profile" ON client_profiles;
CREATE POLICY "Users insert own client profile" ON client_profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own client profile" ON client_profiles;
CREATE POLICY "Users update own client profile" ON client_profiles
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

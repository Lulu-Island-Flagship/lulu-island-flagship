-- Políticas RLS faltantes para client_profiles.
-- Necesarias para que el cotizador cree/actualice el perfil del cliente autenticado
-- (score progresivo, tipo de cuenta B2B, etc.).

CREATE POLICY IF NOT EXISTS "Users insert own client profile" ON client_profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY IF NOT EXISTS "Users update own client profile" ON client_profiles
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

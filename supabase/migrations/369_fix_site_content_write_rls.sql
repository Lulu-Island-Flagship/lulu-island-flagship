-- Fix (auditoría MANIFEST v4.2, 2026-08-14 · C.1 Authz / RLS):
-- La política "auth_write" permitía a CUALQUIER usuario autenticado
-- INSERT/UPDATE/DELETE sobre site_content, delegando la autorización a la API
-- (que un cliente malicioso elude usando el cliente Supabase directo).
--
-- La escritura legítima ocurre vía la API de admin con service_role
-- (requireAdminRole). Se restringe a service_role; la lectura pública se
-- mantiene intacta en la política "public_read" (FOR SELECT TO anon, authenticated).
DROP POLICY IF EXISTS "auth_write" ON site_content;
CREATE POLICY "auth_write" ON site_content
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

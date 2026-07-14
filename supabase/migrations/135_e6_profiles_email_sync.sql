-- Migración 135 — v8.3 E6: email del cliente disponible en `profiles`
--
-- Contexto: el motor de comunicaciones (send-communication.ts) ya decide
-- CUÁNDO y POR QUÉ CANAL enviar, pero el canal 'email' quedaba siempre en
-- 'queued' sin adaptador. Al construir el adaptador (src/lib/email.ts,
-- mismo patrón que sms.ts) se encontró que ni siquiera había DÓNDE leer el
-- correo del destinatario: `profiles` solo tiene `phone` (poblado por la
-- verificación SMS de E1), no `email`. auth.users.email existe pero no es
-- consultable desde el cliente normal (requiere service role, que el
-- proyecto evita deliberadamente fuera de crons -- ver comentario en
-- src/app/api/quote/route.ts).
--
-- Diseño: columna `email` en `profiles`, backfill único desde auth.users
-- para las cuentas que ya existen, y un trigger que la mantiene sincronizada
-- hacia adelante (alta o cambio de email en auth.users). Solo lectura desde
-- la app -- se escribe únicamente vía este trigger, nunca vía UPDATE directo
-- de la app (evita que profiles.email diverja de la fuente real de auth).

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS email TEXT;

-- Backfill único: todas las cuentas existentes hoy.
UPDATE profiles p
SET email = u.email
FROM auth.users u
WHERE u.id = p.id AND p.email IS NULL;

-- UPSERT, no UPDATE: no se encontró ningún INSERT INTO profiles en el resto
-- del proyecto (ni en migraciones ni en la app) -- no hay garantía de que la
-- fila ya exista cuando un usuario nuevo se registra. Un UPDATE puro
-- degradaría en silencio (0 filas afectadas, sin error) igual que el resto
-- del código ya tolera `profile?.phone` ausente; el UPSERT además cierra ese
-- hueco latente en vez de solo evitar el error.
CREATE OR REPLACE FUNCTION sync_profile_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO profiles (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_profile_email ON auth.users;
CREATE TRIGGER trg_sync_profile_email
  AFTER INSERT OR UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION sync_profile_email();

COMMENT ON COLUMN profiles.email IS
  'v8.3 E6: espejo de auth.users.email, mantenido por trigger sync_profile_email(). Existe para que el adaptador de email (src/lib/email.ts) tenga de dónde leer sin necesitar service role. No editar directamente -- se sobrescribe en el próximo UPDATE de auth.users.';

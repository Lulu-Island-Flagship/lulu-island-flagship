-- Migración 330 — prellenar profiles.full_name/avatar_url desde el login de
-- Google (opinión pedida por el usuario 2026-08-02: "usar lo que dice en su
-- cuenta de Google [...] para que no tenga que llenar todo").
--
-- Contexto: profiles.full_name y profiles.avatar_url existen desde la
-- migración 001, pero nada en el código los escribe nunca -- se verificó por
-- grep en toda la app (src/ y supabase/) que ninguna consulta lee
-- user_metadata/raw_user_meta_data del login social. Google SÍ entrega
-- nombre y foto en el login estándar (scopes por defecto openid/email/
-- profile, sin permisos adicionales -- ver AuthModal.tsx handleGoogleSignIn,
-- no pide `scopes` extra), a diferencia de teléfono/dirección, que Google no
-- expone sin un scope restringido de Google People API (revisión de
-- seguridad anual de Google, no vale la pena para este negocio).
--
-- Diseño: mismo patrón que sync_profile_email() (migración 135) -- trigger
-- SECURITY DEFINER en auth.users, porque profiles no es consultable con
-- service role desde la app fuera de crons (ver comentario en esa
-- migración). Diferencia clave respecto a sync_profile_email(): el email es
-- SIEMPRE autoritativo desde auth.users así que ese trigger sobre-escribe en
-- cada UPDATE; full_name/avatar_url en cambio deben quedar EDITABLES por el
-- cliente (dijo explícitamente que los datos de Google "no siempre están
-- actualizados"). Este trigger solo rellena un valor que hoy está NULL --
-- nunca pisa un valor ya existente, así que en cuanto el cliente lo edita
-- una vez (o si ya lo tenía puesto de antes), Google deja de tocarlo para
-- siempre, incluso si vuelve a iniciar sesión con datos distintos en Google.

CREATE OR REPLACE FUNCTION sync_profile_name_avatar_from_google()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  google_full_name TEXT;
  google_avatar_url TEXT;
BEGIN
  -- Supabase normaliza el payload de Google OAuth en raw_user_meta_data con
  -- las claves 'full_name'/'name' y 'avatar_url'/'picture' (el nombre exacto
  -- de la clave varía según versión del proveedor social de Supabase Auth;
  -- se prueban ambas variantes conocidas, la primera que exista gana).
  google_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name');
  google_avatar_url := COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture');

  -- Sin nombre ni foto en el metadata (ej. login por email/teléfono OTP, sin
  -- proveedor social): nada que sincronizar, no crear una fila vacía --
  -- sync_profile_email() (migración 135) ya se encarga de crear/mantener la
  -- fila para el email en ese caso.
  IF google_full_name IS NULL AND google_avatar_url IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO profiles (id, full_name, avatar_url)
  VALUES (NEW.id, google_full_name, google_avatar_url)
  ON CONFLICT (id) DO UPDATE SET
    full_name = COALESCE(profiles.full_name, EXCLUDED.full_name),
    avatar_url = COALESCE(profiles.avatar_url, EXCLUDED.avatar_url),
    updated_at = now()
  WHERE profiles.full_name IS NULL OR profiles.avatar_url IS NULL;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_profile_name_avatar_from_google ON auth.users;
CREATE TRIGGER trg_sync_profile_name_avatar_from_google
  AFTER INSERT OR UPDATE OF raw_user_meta_data ON auth.users
  FOR EACH ROW EXECUTE FUNCTION sync_profile_name_avatar_from_google();

-- Backfill único: cuentas de Google que ya existen hoy y todavía no tienen
-- full_name/avatar_url en profiles (no pisa ninguna que el cliente ya haya
-- editado, por el mismo WHERE que usa el trigger).
UPDATE profiles p
SET
  full_name = COALESCE(p.full_name, COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name')),
  avatar_url = COALESCE(p.avatar_url, COALESCE(u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture')),
  updated_at = now()
FROM auth.users u
WHERE u.id = p.id
  AND (p.full_name IS NULL OR p.avatar_url IS NULL)
  AND (
    COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name') IS NOT NULL
    OR COALESCE(u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture') IS NOT NULL
  );

COMMENT ON FUNCTION sync_profile_name_avatar_from_google() IS
  'Migración 330 (2026-08-02): rellena profiles.full_name/avatar_url desde el login de Google (raw_user_meta_data) SOLO si la columna está NULL -- nunca sobre-escribe un valor ya existente o editado por el cliente. Ver preferencias/page.tsx para el formulario donde el cliente puede corregirlo.';

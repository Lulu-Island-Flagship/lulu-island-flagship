-- v8.3 E0 — Códigos de respaldo (backup codes) de un solo uso para owner_admin.
--
-- Contexto: owner_admin (dueño/manager, acceso total: finanzas, nómina,
-- compliance) hoy solo entra por Google OAuth (AdminLoginScreen.tsx) o por
-- el link de email OTP genérico (mismo mecanismo, no es un "backup" real
-- porque depende del mismo buzón). Si pierde acceso a su cuenta de Google,
-- necesita un segundo factor de respaldo tipo GitHub/Google 2FA -- códigos
-- de un solo uso generados con antelación y guardados fuera de línea -- sin
-- abrir un endpoint tipo "olvidé mi contraseña" público (que sería una
-- superficie de ataque nueva sobre la cuenta con más privilegios del
-- sistema).
--
-- Diseño de la tabla: NUNCA se guarda el código en texto plano -- solo su
-- hash SHA-256 (mismo primitivo ya usado en el repo para hashing
-- server-side, ver createHash("sha256") en src/lib/anti-gaming.ts). El texto
-- plano solo existe en memoria del servidor durante la generación y en la
-- respuesta HTTP de esa única llamada -- después es irrecuperable incluso
-- para nosotros, igual que un password hasheado.
--
-- used_at   : cuándo se consumió el código para iniciar sesión (login real).
-- revoked_at: cuándo quedó invalidado SIN haberse usado para login -- pasa
--             cuando el owner_admin genera un set nuevo y el anterior aún
--             tenía códigos sin usar (evita que códigos viejos impresos/
--             guardados sigan siendo válidos indefinidamente).
-- Separar ambos campos (en vez de reusar uno solo) deja rastro de auditoría
-- honesto: "se usó de verdad para entrar" es un evento muy distinto de
-- "quedó obsoleto porque se generó un set nuevo".

CREATE TABLE IF NOT EXISTS owner_admin_backup_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (code_hash)
);

CREATE INDEX IF NOT EXISTS idx_owner_admin_backup_codes_user
  ON owner_admin_backup_codes(user_id)
  WHERE used_at IS NULL AND revoked_at IS NULL;

-- Inmutable: nunca se borra físicamente (invariante B.2.9, mismo patrón que
-- admin_action_logs). "Borrar" un set viejo se hace con revoked_at, no DELETE.
DROP TRIGGER IF EXISTS trg_prevent_delete ON owner_admin_backup_codes;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON owner_admin_backup_codes
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

ALTER TABLE owner_admin_backup_codes ENABLE ROW LEVEL SECURITY;

-- Lectura: SOLO el propio owner_admin puede ver el estado (hashes, fechas)
-- de sus propios códigos -- nunca otro rol, ni siquiera ops_coordinator, y
-- nunca otro owner_admin (por si en el futuro hay más de uno). No expone el
-- código en texto plano (nunca se guarda), solo permite a la UI mostrar
-- "tienes 6 códigos sin usar, generados el 2026-07-19".
CREATE POLICY "owner_admin reads own backup codes" ON owner_admin_backup_codes
  FOR SELECT USING (
    user_id = auth.uid()
    AND has_admin_role(auth.uid(), ARRAY['owner_admin'])
  );

-- Generación: solo el propio owner_admin, y solo si el rol sigue vigente
-- (has_admin_role revisa deleted_at IS NULL en admin_roles).
CREATE POLICY "owner_admin creates own backup codes" ON owner_admin_backup_codes
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND has_admin_role(auth.uid(), ARRAY['owner_admin'])
  );

-- No hay política de UPDATE con el cliente RLS-scoped a propósito: marcar
-- used_at ocurre en /api/admin/backup-codes/verify, que corre ANTES de que
-- exista una sesión autenticada (el usuario todavía no pudo iniciar sesión
-- -- para eso está usando el código) -- por diseño usa
-- getServiceRoleClient() (service_role, bypassa RLS), igual que otros
-- endpoints server-side ya documentados en src/lib/admin.ts. revocar el set
-- anterior al generar uno nuevo también corre con el cliente RLS-scoped del
-- owner_admin autenticado dentro del mismo endpoint POST -- se resuelve con
-- una función SECURITY DEFINER angosta en vez de abrir UPDATE por RLS,
-- para no crear una superficie de "cualquiera con INSERT también puede
-- reescribir codes ajenos" por accidente.
CREATE OR REPLACE FUNCTION revoke_own_unused_backup_codes()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected INTEGER;
BEGIN
  UPDATE owner_admin_backup_codes
  SET revoked_at = now()
  WHERE user_id = auth.uid()
    AND used_at IS NULL
    AND revoked_at IS NULL;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

COMMENT ON TABLE owner_admin_backup_codes IS
  'v8.3 E0: códigos de respaldo de un solo uso para owner_admin (2FA de emergencia si pierde acceso a Google). Solo se guarda code_hash (SHA-256) -- el texto plano nunca se persiste. RLS: solo el propio owner_admin lee/genera los suyos.';

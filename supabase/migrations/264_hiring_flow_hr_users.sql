-- v0.4.1 (flujo de contratación) -- Fase 2 "Modelo de Datos Completo".
-- `hr_users` es el catálogo de personas de HR (reclutadores, admins de
-- HR) que operan el flujo de contratación desde el lado interno
-- (revisar candidatos, aprobar/rechazar, etc.).
--
-- Por qué esta tabla existe separada del sistema de roles admin
-- existente (`admin_roles`/`has_admin_role`, ver 251-252 y src/lib/
-- admin.ts) en vez de reutilizarlo: es una separación deliberada de este
-- módulo nuevo (v0.4.1 nota explícitamente que HR opera con sesiones/
-- scopes distintos a los del sistema principal -- ver Fase 6 del plan).
-- Mezclar los roles de HR de este flujo de contratación con los roles
-- admin del sistema financiero/operativo principal acoplaría dos
-- dominios que deben poder evolucionar (y revocarse) independientemente
-- -- ej. un reclutador no debería heredar accidentalmente ningún
-- permiso del panel admin principal solo por existir en la misma tabla
-- de roles.
--
-- `auth_user_id` SÍ referencia auth.users (a diferencia de `candidates`,
-- que no tiene fila en auth.users): el personal de HR es interno y usa
-- el login normal de Supabase Auth del repo -- este registro es su perfil
-- de rol dentro del módulo de contratación, no un reemplazo de auth.

CREATE TABLE IF NOT EXISTS hr_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('recruiter', 'hr_admin')),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hr_users_auth_user_id ON hr_users (auth_user_id);

ALTER TABLE hr_users ENABLE ROW LEVEL SECURITY;

-- Service-role-only: la verificación de "¿este usuario es HR y de qué
-- rol?" la hace una función/servicio equivalente a has_admin_role() pero
-- propia de este módulo (fuera de alcance de esta migración), consultada
-- con service role -- nunca lectura directa desde el cliente
-- anon/authenticated, para no filtrar qué cuentas internas existen.
DROP POLICY IF EXISTS "hr_users no direct access" ON hr_users;
CREATE POLICY "hr_users no direct access" ON hr_users
  FOR ALL USING (false) WITH CHECK (false);

COMMENT ON TABLE hr_users IS
  'v0.4.1 flujo de contratación: catálogo de personal de HR (reclutador/ '
  'hr_admin) que opera el flujo. Deliberadamente separado de '
  'admin_roles del sistema principal (scopes/sesiones distintos). '
  'Acceso exclusivo vía service role.';

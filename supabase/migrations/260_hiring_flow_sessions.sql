-- v0.4.1 (flujo de contratación) -- Fase 2 "Modelo de Datos Completo".
-- `sessions` es la sesión de un candidato dentro del flujo, creada
-- después de validar un access_code (259). Es el mecanismo de
-- "estoy logueado" para candidatos, en reemplazo de Supabase Auth
-- (ver comentario de cabecera de candidates, 257).
--
-- Por qué `token_hash` y NUNCA el token en texto plano: mismo criterio
-- exacto que `code_hash` en access_codes (259) -- un session token es
-- equivalente a una cookie de sesión/API key; solo se guarda su hash. El
-- token crudo se entrega una sola vez al candidato (ej. en una cookie
-- httpOnly) y se compara por hash en cada request.
--
-- Por qué `last_activity_at` separado de `created_at`: permite
-- implementar expiración por inactividad (ej. "cerrar sesión tras 30 min
-- sin actividad") además de la expiración absoluta (`expires_at`), sin
-- tener que recalcular ni sobreescribir `created_at`.
--
-- Por qué `invalidated_at` en vez de borrar la fila al cerrar sesión: se
-- preserva el registro para auditoría (ej. "el candidato cerró sesión
-- manualmente a las X" vs "expiró sola") -- el job de limpieza (ver
-- índice en expires_at) borra sesiones EXPIRADAS por antigüedad, no
-- sesiones invalidadas recientemente.

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  invalidated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índice en expires_at para el job de limpieza que borra sesiones
-- expiradas (ver comentario de cabecera) sin tener que hacer un seq
-- scan sobre toda la tabla en cada corrida.
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- Service-role-only: la validación de sesión (hash del token de cookie
-- contra token_hash) la hace middleware/API con service role -- nunca
-- expuesto al cliente anon/authenticated.
DROP POLICY IF EXISTS "sessions no direct access" ON sessions;
CREATE POLICY "sessions no direct access" ON sessions
  FOR ALL USING (false) WITH CHECK (false);

COMMENT ON TABLE sessions IS
  'v0.4.1 flujo de contratación: sesiones de candidato (reemplazo de '
  'Supabase Auth para este flujo sin cuenta). token_hash NUNCA es el '
  'token en texto plano. Índice en expires_at para el job de limpieza. '
  'Acceso exclusivo vía service role.';

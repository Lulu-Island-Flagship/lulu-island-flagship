-- v0.4.1 (flujo de contratación) -- Fase 2 "Modelo de Datos Completo".
-- `positions` es la vacante/puesto para el que aplica un candidato. Es la
-- raíz del modelo: todo candidato (migración 257) referencia una
-- position_id.
--
-- Por qué `slug` UNIQUE y no solo `id`: el flujo público (candidato sin
-- login, ver comentario de legal_texts en 253) necesita una URL legible y
-- estable para compartir la vacante (ej. /aplicar/recepcionista-2026) sin
-- exponer el UUID interno como único identificador de cara al público.
--
-- Por qué RLS con lectura pública condicionada a `is_public = true`: mismo
-- patrón que legal_texts (253) -- los candidatos ven la vacante ANTES de
-- cualquier autenticación, así que debe ser accesible sin auth.uid(). Se
-- expone solo lo que el propio flag de negocio marca como público
-- (vacantes cerradas/borrador nunca se listan). Escritura exclusiva de
-- service role, igual que el resto del módulo.

CREATE TABLE IF NOT EXISTS positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  is_public BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- ON DELETE SET NULL en created_by: si el usuario admin que creó la
-- vacante es eliminado de auth.users, la vacante y su historial de
-- candidatos deben sobrevivir (no tiene sentido perder o bloquear el
-- borrado del usuario por una referencia puramente informativa de
-- "quién la creó").

CREATE INDEX IF NOT EXISTS idx_positions_is_public ON positions (is_public);

ALTER TABLE positions ENABLE ROW LEVEL SECURITY;

-- Lectura pública SOLO de vacantes marcadas is_public = true (mismo
-- criterio que legal_texts/is_active en 253): el candidato ve el listado
-- de vacantes abiertas antes de tener cuenta.
DROP POLICY IF EXISTS "positions public read public" ON positions;
CREATE POLICY "positions public read public" ON positions
  FOR SELECT USING (is_public = true);

-- Escritura exclusiva de service role -- crear/editar/cerrar vacantes es
-- una operación administrativa que pasa por una API con
-- requireAdminRole() (o equivalente de HR, ver hr_users en 264), nunca
-- directo desde el cliente anon/authenticated.
DROP POLICY IF EXISTS "positions no direct insert" ON positions;
CREATE POLICY "positions no direct insert" ON positions
  FOR INSERT WITH CHECK (false);
DROP POLICY IF EXISTS "positions no direct update" ON positions;
CREATE POLICY "positions no direct update" ON positions
  FOR UPDATE USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "positions no direct delete" ON positions;
CREATE POLICY "positions no direct delete" ON positions
  FOR DELETE USING (false);

COMMENT ON TABLE positions IS
  'v0.4.1 flujo de contratación: vacantes/puestos para los que aplican '
  'candidatos. Lectura pública solo donde is_public = true (candidatos '
  'sin login); escritura exclusiva de service role.';

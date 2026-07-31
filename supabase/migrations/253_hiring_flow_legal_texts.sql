-- v0.4.1 (flujo de contratación) -- `legal_texts` guarda el contenido
-- versionado de textos legales que el candidato debe ver/aceptar durante
-- el flujo de contratación (ej. aviso PIPA de BC, consentimiento para
-- verificación de antecedentes / CRC). Se versiona por (key, version) en
-- vez de sobreescribir in place porque hace falta poder demostrar más
-- adelante EXACTAMENTE qué texto aceptó un candidato en un momento dado
-- (ese vínculo candidato-versión-aceptación vive en otra tabla del módulo,
-- fuera de alcance de esta migración -- se integrará después).
--
-- Por qué "máximo 1 fila activa por key" vía índice único parcial en vez
-- de una columna booleana simple con chequeo en la app: un índice único
-- parcial (`WHERE is_active`) lo garantiza a nivel de base de datos sin
-- importar por qué código se inserte/actualice la fila -- no depende de
-- que la app recuerde desactivar la versión anterior antes de activar la
-- nueva. Si dos requests concurrentes intentan activar dos versiones a la
-- vez, Postgres rechaza la segunda con una violación de unicidad en vez de
-- dejar dos textos "activos" simultáneos (lo cual sería un problema legal
-- real: ambigüedad sobre qué texto rigió en un momento dado).
--
-- Por qué la lectura de textos ACTIVOS es pública (RLS `USING (is_active)`
-- para SELECT): los candidatos ven y deben aceptar estos textos ANTES de
-- tener cuenta/login (es la primera pantalla del flujo de contratación),
-- así que no hay auth.uid() disponible todavía en ese punto. Se expone
-- solo lo estrictamente necesario -- las columnas de texto activo, nunca
-- versiones inactivas/históricas ni metadata de auditoría más allá de lo
-- ya público. La escritura (INSERT/UPDATE/DELETE) es exclusiva de service
-- role -- ningún rol de app puede versionar o activar textos legales
-- directamente.

CREATE TABLE IF NOT EXISTS legal_texts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL,
  version TEXT NOT NULL,
  content TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT false,
  effective_from TIMESTAMPTZ,
  effective_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  UNIQUE (key, version)
);

-- Garantiza a nivel de DB que nunca haya más de 1 versión activa por key
-- (ver comentario de cabecera).
CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_texts_one_active_per_key
  ON legal_texts (key)
  WHERE is_active;

CREATE INDEX IF NOT EXISTS idx_legal_texts_key ON legal_texts (key);

ALTER TABLE legal_texts ENABLE ROW LEVEL SECURITY;

-- Lectura pública SOLO de textos activos: los candidatos los necesitan ver
-- sin estar logueados (primera pantalla del flujo de contratación, antes
-- de tener cuenta). No se expone la tabla completa -- la condición
-- `is_active` en la policy filtra versiones históricas/inactivas incluso
-- si alguien consulta la tabla directamente con el cliente anon.
DROP POLICY IF EXISTS "legal_texts public read active" ON legal_texts;
CREATE POLICY "legal_texts public read active" ON legal_texts
  FOR SELECT USING (is_active = true);

-- Escritura exclusiva de service role: crear una nueva versión, activarla,
-- o desactivar una vigente son operaciones administrativas/legales que
-- deben pasar por una API con requireAdminRole() (mismo patrón que
-- system_settings). Se declaran policies explícitas de INSERT/UPDATE/
-- DELETE (en vez de una sola FOR ALL) a propósito: FOR ALL también cubre
-- SELECT, y con múltiples policies permisivas para el mismo comando
-- Postgres las combina con OR -- una FOR ALL con USING(false) aquí no
-- pisaría la policy de lectura pública de arriba, pero declarar los
-- comandos de escritura por separado deja explícito que la única
-- excepción de acceso es la lectura pública de textos activos.
DROP POLICY IF EXISTS "legal_texts no direct write" ON legal_texts;
CREATE POLICY "legal_texts no direct write" ON legal_texts
  FOR INSERT WITH CHECK (false);
DROP POLICY IF EXISTS "legal_texts no direct update" ON legal_texts;
CREATE POLICY "legal_texts no direct update" ON legal_texts
  FOR UPDATE USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "legal_texts no direct delete" ON legal_texts;
CREATE POLICY "legal_texts no direct delete" ON legal_texts
  FOR DELETE USING (false);

COMMENT ON TABLE legal_texts IS
  'v0.4.1 flujo de contratación: textos legales versionados (PIPA, '
  'consentimiento CRC, etc.). Lectura pública solo de la versión activa '
  '(candidatos sin login la necesitan ver); escritura exclusiva de '
  'service role. Índice único parcial garantiza máximo 1 versión activa '
  'por key.';

-- v0.4.1 (flujo de contratación) -- Fase 2 "Modelo de Datos Completo".
-- `candidates` es la entidad central del flujo: una persona que aplica a
-- una `positions` (256). Los candidatos NO tienen fila en auth.users en
-- este diseño -- no inician sesión con el sistema de auth de Supabase.
-- Su identidad/sesión se maneja con `access_codes` (259) y `sessions`
-- (260), tablas de este mismo módulo, no con Supabase Auth.
--
-- Por qué `position_id` es ON DELETE RESTRICT y no CASCADE ni SET NULL:
-- un candidato es un registro con valor legal/de auditoría propio (datos
-- personales, documentos, firmas, consentimientos -- ver 261, 262, 263).
-- Borrar una `position` nunca debe arrastrar el borrado silencioso de
-- candidatos ni dejarlos "huérfanos" sin vacante asociada -- si hace
-- falta remover una vacante que ya tiene candidatos, eso es una decisión
-- explícita que debe manejarse a nivel de aplicación (reasignar o
-- archivar candidatos primero), no un efecto colateral del DELETE.
--
-- Por qué `status` es un CHECK enumerado y no una tabla de catálogo
-- aparte: el conjunto de estados es pequeño, fijo, y forma parte del
-- contrato del flujo (cada estado dispara lógica específica en el
-- servicio TS) -- no se espera que un admin agregue estados nuevos sin
-- tocar código, así que no vale la pena la indirección de una tabla.
--
-- Por qué RLS es 100% service-role-only (sin excepción de lectura
-- pública, a diferencia de positions/legal_texts): los datos de un
-- candidato son PII (nombre, email, teléfono, fecha de nacimiento). El
-- candidato mismo accede a su propio registro exclusivamente a través de
-- rutas de API que validan su `sessions.token_hash` (260) contra la DB
-- con service role -- nunca directo vía el cliente Supabase del
-- navegador, porque no hay auth.uid() que identifique "soy este
-- candidato" en el modelo de Supabase Auth.

CREATE TABLE IF NOT EXISTS candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id UUID REFERENCES positions(id) ON DELETE RESTRICT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  date_of_birth DATE,
  status TEXT NOT NULL DEFAULT 'step1_completed'
    CHECK (status IN ('step1_completed', 'step2_completed', 'step3_completed', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_candidates_email ON candidates (email);
CREATE INDEX IF NOT EXISTS idx_candidates_status ON candidates (status);

ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;

-- Service-role-only, sin ninguna policy permisiva: ver justificación en
-- el comentario de cabecera (PII, sin auth.uid() disponible para
-- candidatos).
DROP POLICY IF EXISTS "candidates no direct access" ON candidates;
CREATE POLICY "candidates no direct access" ON candidates
  FOR ALL USING (false) WITH CHECK (false);

COMMENT ON TABLE candidates IS
  'v0.4.1 flujo de contratación: candidatos que aplican a una position. '
  'PII -- acceso exclusivo vía service role; el candidato mismo accede a '
  'su registro solo a través de rutas de API validadas por sessions '
  '(260), nunca directo (no tiene fila en auth.users).';

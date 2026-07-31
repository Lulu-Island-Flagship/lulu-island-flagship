-- Módulo de Cliente -- `client_consents` registra cada aceptación (o
-- rechazo) de un texto legal (`legal_texts`, 253 -- tabla ya existente
-- del módulo de empleado, reutilizada aquí como infraestructura genérica
-- compartida, NO se crea una tabla de textos legales nueva) por parte de
-- un `clients` (269). Mismo patrón que `consents` (263) del módulo de
-- empleado.
--
-- Regla explícita: nunca guardes solo "aceptó: true" -- guarda QUÉ texto
-- (`legal_text_key` + `legal_text_version`, y la referencia dura
-- `legal_text_id`), QUÉ VERSIÓN exacta, FECHA/HORA (`created_at`), IP y
-- user agent. Un booleano solo no sirve para demostrar después qué texto
-- específico vio y aceptó el cliente si `legal_texts` cambia de versión
-- con el tiempo.
--
-- Por qué `client_id` es ON DELETE CASCADE (a diferencia de
-- `legal_text_id`, que es RESTRICT): el consentimiento es un hecho
-- vinculado al cliente -- si el cliente se borra (caso excepcional, ej.
-- solicitud PIPA de eliminación de datos), su historial de
-- consentimientos se borra con él. En cambio `legal_text_id` es
-- RESTRICT porque un `legal_texts` nunca debería borrarse mientras exista
-- un consentimiento que lo referencia (perdería trazabilidad legal
-- exacta) -- mismo razonamiento que `consents` (263).
--
-- Por qué esta tabla, igual que `consents` (263), NO tiene policy de
-- UPDATE ni DELETE: un consentimiento es un hecho histórico inmutable --
-- se corrige (si hiciera falta) insertando un nuevo consentimiento,
-- nunca editando uno existente.

CREATE TABLE IF NOT EXISTS client_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  consent_type TEXT NOT NULL
    CHECK (consent_type IN ('service_agreement', 'pipa_consent', 'photo_consent', 'key_handling_policy', 'cancellation_policy', 'damage_liability')),
  legal_text_key TEXT NOT NULL,
  legal_text_version TEXT NOT NULL,
  legal_text_id UUID REFERENCES legal_texts(id) ON DELETE RESTRICT,
  accepted BOOLEAN NOT NULL,
  ip_address TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_consents_client_id ON client_consents (client_id);
CREATE INDEX IF NOT EXISTS idx_client_consents_consent_type ON client_consents (consent_type);

ALTER TABLE client_consents ENABLE ROW LEVEL SECURITY;

-- Solo INSERT y SELECT, ambos service-role-only. Deliberadamente SIN
-- policy de UPDATE ni DELETE (ver comentario de cabecera) -- mismo
-- patrón que `consents` (263) del módulo de empleado.
DROP POLICY IF EXISTS "client_consents no direct insert" ON client_consents;
CREATE POLICY "client_consents no direct insert" ON client_consents
  FOR INSERT WITH CHECK (false);
DROP POLICY IF EXISTS "client_consents no direct select" ON client_consents;
CREATE POLICY "client_consents no direct select" ON client_consents
  FOR SELECT USING (false);

COMMENT ON TABLE client_consents IS
  'Módulo de Cliente: registro inmutable de aceptación de textos legales '
  'por parte de un cliente. Nunca guarda solo accepted:true -- guarda '
  'qué texto (key+version+id), fecha/hora, IP y user agent. Sin policy '
  'de UPDATE/DELETE a propósito. Reutiliza legal_texts (253) del módulo '
  'de empleado. Acceso exclusivo vía service role.';

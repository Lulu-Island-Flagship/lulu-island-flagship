-- v0.4.1 (flujo de contratación) -- Fase 2 "Modelo de Datos Completo".
-- `consents` registra cada aceptación (o rechazo) de un texto legal
-- (`legal_texts`, 253) por parte de un candidato.
--
-- Regla explícita del plan: nunca guardes solo "aceptó: true" -- guarda
-- QUÉ texto (`legal_text_key` + `legal_text_version`, y la referencia
-- dura `legal_text_id`), QUÉ VERSIÓN exacta, FECHA/HORA (`created_at`),
-- IP y user agent. Un booleano solo no sirve para demostrar después qué
-- texto específico vio y aceptó el candidato si `legal_texts` cambia de
-- versión con el tiempo.
--
-- Por qué se guardan `legal_text_key`/`legal_text_version` en TEXTO
-- además del `legal_text_id` (UUID): el id es la referencia dura e
-- inequívoca a la fila exacta de legal_texts, pero key/version
-- desnormalizados hacen que el consentimiento siga siendo legible/
-- auditable por sí solo (ej. en un export o reporte) sin tener que hacer
-- join, y sobreviven incluso si en algún escenario excepcional la fila
-- de legal_texts se pierde -- aunque en el uso normal el JOIN vía
-- legal_text_id es la fuente de verdad.
--
-- Por qué `legal_text_id` es ON DELETE RESTRICT: un legal_texts nunca
-- debería borrarse mientras existan consentimientos que lo referencian
-- (perdería la trazabilidad legal exacta) -- si hace falta remover una
-- versión de texto legal, debe ser una decisión explícita fuera de este
-- flujo normal, nunca un efecto colateral silencioso de un DELETE.
--
-- Por qué esta tabla, igual que electronic_signatures (262), NO tiene
-- policy de UPDATE ni DELETE: un consentimiento es un hecho histórico
-- inmutable -- se corrige (si hiciera falta) insertando un nuevo
-- consentimiento, nunca editando uno existente.

CREATE TABLE IF NOT EXISTS consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  legal_text_key TEXT NOT NULL,
  legal_text_version TEXT NOT NULL,
  legal_text_id UUID REFERENCES legal_texts(id) ON DELETE RESTRICT,
  accepted BOOLEAN NOT NULL,
  ip_address TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consents_candidate_id ON consents (candidate_id);
CREATE INDEX IF NOT EXISTS idx_consents_legal_text_key ON consents (legal_text_key);

ALTER TABLE consents ENABLE ROW LEVEL SECURITY;

-- Solo INSERT y SELECT, ambos service-role-only. Deliberadamente SIN
-- policy de UPDATE ni DELETE (ver comentario de cabecera) -- mismo
-- patrón que electronic_signatures (262).
DROP POLICY IF EXISTS "consents no direct insert" ON consents;
CREATE POLICY "consents no direct insert" ON consents
  FOR INSERT WITH CHECK (false);
DROP POLICY IF EXISTS "consents no direct select" ON consents;
CREATE POLICY "consents no direct select" ON consents
  FOR SELECT USING (false);

COMMENT ON TABLE consents IS
  'v0.4.1 flujo de contratación: registro inmutable de aceptación de '
  'textos legales. Nunca guarda solo accepted:true -- guarda qué texto '
  '(key+version+id), fecha/hora, IP y user agent. Sin policy de UPDATE/ '
  'DELETE a propósito. Acceso exclusivo vía service role.';

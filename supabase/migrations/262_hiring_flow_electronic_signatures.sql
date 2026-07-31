-- v0.4.1 (flujo de contratación) -- Fase 2 "Modelo de Datos Completo".
-- `electronic_signatures` registra cada firma electrónica que un
-- candidato produce durante el flujo (ej. firmar un documento de oferta,
-- una política interna).
--
-- La firma electrónica NO es un booleano ("firmado: true/false") -- es un
-- registro inmutable con evidencia suficiente para sostenerla legalmente:
-- qué se firmó (`document_reference`), el hash del contenido firmado en
-- ese momento (`document_hash`, para poder demostrar que el documento no
-- cambió después de la firma), cuándo (`signed_at`), y desde dónde
-- (`ip_address`, `user_agent`). Guardar solo un booleano perdería toda
-- esa evidencia y volvería la firma indefendible ante una disputa.
--
-- Por qué esta tabla NO tiene policy de UPDATE (ni siquiera USING(false)
-- explícito) ni de DELETE: una firma registrada nunca se edita ni se
-- borra -- es un hecho histórico. Declarar una policy USING(false) para
-- UPDATE/DELETE seguiría bloqueando el acceso iguelmente vía el cliente
-- anon/authenticated (RLS deniega por defecto sin policy), pero se omite
-- a propósito para dejar explícito en el schema que esas operaciones ni
-- siquiera están contempladas como concepto para esta tabla -- no es
-- "está bloqueada", es "no existe". Nótese que RLS no protege contra
-- service role (que bypassea RLS); la garantía de inmutabilidad frente a
-- service role depende de que ningún código del módulo emita UPDATE/
-- DELETE contra esta tabla -- convención de servicio, no de DB.

CREATE TABLE IF NOT EXISTS electronic_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  document_reference TEXT NOT NULL,
  document_hash TEXT NOT NULL,
  signed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address TEXT NOT NULL,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_electronic_signatures_candidate_id
  ON electronic_signatures (candidate_id);

ALTER TABLE electronic_signatures ENABLE ROW LEVEL SECURITY;

-- Solo INSERT y SELECT, ambos service-role-only. Deliberadamente SIN
-- policy de UPDATE ni DELETE (ver comentario de cabecera) -- la firma es
-- un registro inmutable, nunca editable.
DROP POLICY IF EXISTS "electronic_signatures no direct insert" ON electronic_signatures;
CREATE POLICY "electronic_signatures no direct insert" ON electronic_signatures
  FOR INSERT WITH CHECK (false);
DROP POLICY IF EXISTS "electronic_signatures no direct select" ON electronic_signatures;
CREATE POLICY "electronic_signatures no direct select" ON electronic_signatures
  FOR SELECT USING (false);

COMMENT ON TABLE electronic_signatures IS
  'v0.4.1 flujo de contratación: registro inmutable de firmas '
  'electrónicas -- NO es un booleano, guarda qué se firmó, hash del '
  'contenido, fecha/hora, IP y user agent. Sin policy de UPDATE/DELETE a '
  'propósito -- nunca editable. Acceso exclusivo vía service role.';

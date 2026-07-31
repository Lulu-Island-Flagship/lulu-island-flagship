-- v0.4.1 (flujo de contratación) -- Fase 2 "Modelo de Datos Completo".
-- `documents` guarda metadata de archivos subidos por el candidato
-- durante el flujo (ej. identificación, comprobante de domicilio,
-- certificados). El archivo en sí vive en Supabase Storage (u otro
-- object storage) -- esta tabla solo referencia su ubicación
-- (`storage_path`), nunca el contenido binario.
--
-- Por qué `document_type` es TEXT libre y no un CHECK enumerado (a
-- diferencia de `status` en candidates o `purpose` en access_codes): el
-- catálogo de tipos de documento requeridos puede variar por vacante o
-- cambiar por requisito legal sin que eso implique una migración de
-- schema -- se valida en el servicio TS contra la configuración
-- (`system_settings`, 251), no a nivel de DB.
--
-- Por qué `size_bytes CHECK (size_bytes > 0)`: un documento con tamaño
-- 0 o negativo es un dato corrupto/incompleto (upload fallido a medias)
-- -- se rechaza a nivel de DB en vez de confiar en que el servicio TS
-- siempre valide antes de insertar.
--
-- Por qué ON DELETE CASCADE con candidates: los documentos son parte del
-- expediente del candidato -- no tienen valor propio fuera de él. (El
-- archivo físico en Storage se limpia por separado, a cargo del
-- servicio TS -- fuera de alcance de esta migración de solo metadata.)

CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documents_candidate_id ON documents (candidate_id);

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

-- Service-role-only: subir/leer documentos pasa por una API que valida
-- la sesión del candidato (o el rol de HR) y genera/valida URLs firmadas
-- de Storage -- nunca acceso directo a la tabla desde el cliente.
DROP POLICY IF EXISTS "documents no direct access" ON documents;
CREATE POLICY "documents no direct access" ON documents
  FOR ALL USING (false) WITH CHECK (false);

COMMENT ON TABLE documents IS
  'v0.4.1 flujo de contratación: metadata de documentos subidos por el '
  'candidato (el archivo vive en Storage, referenciado por '
  'storage_path). Acceso exclusivo vía service role.';

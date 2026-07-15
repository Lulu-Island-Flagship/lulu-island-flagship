-- Migración 165 — v8.3 E9.12: Retención de fotos.
-- "Disputas 2 años, QC 1 año, thumbnails anonimizados indefinido."
--
-- No se crea una tabla nueva de fotos (viven en service_checklist_items.
-- photo_url y warranty_photo_evidence.photo_url, migraciones 006/020) --
-- se agrega SOLO el log de auditoría de purga, inmutable, para poder
-- demostrar qué se borró, cuándo y por qué categoría (necesario para
-- cualquier auditoría de compliance futura).

CREATE TABLE IF NOT EXISTS photo_retention_deletions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table TEXT NOT NULL CHECK (source_table IN ('service_checklist_items', 'warranty_photo_evidence')),
  source_row_id UUID NOT NULL,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  photo_url TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('qc', 'dispute')),
  storage_delete_succeeded BOOLEAN NOT NULL,
  storage_delete_error TEXT,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_photo_retention_deletions_order ON photo_retention_deletions(order_id);
CREATE INDEX IF NOT EXISTS idx_photo_retention_deletions_deleted_at ON photo_retention_deletions(deleted_at);

-- Inmutable: es el registro de auditoría de qué se destruyó y por qué.
DROP TRIGGER IF EXISTS trg_prevent_delete ON photo_retention_deletions;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON photo_retention_deletions
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

ALTER TABLE photo_retention_deletions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Supervisors read photo retention deletions" ON photo_retention_deletions;
CREATE POLICY "Supervisors read photo retention deletions" ON photo_retention_deletions
  FOR SELECT USING (is_supervisor(auth.uid()));

COMMENT ON TABLE photo_retention_deletions IS
  'v8.3 E9.12: log inmutable de purga de fotos por vencimiento de retención (QC 1 año / disputa 2 años, src/lib/photo-retention.ts). El borrado real ocurre en el cron photo-retention-purge -- esta tabla es solo el rastro auditable.';

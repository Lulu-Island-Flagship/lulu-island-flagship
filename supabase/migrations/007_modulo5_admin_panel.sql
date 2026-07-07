-- Migración: agregar reviewed_by_admin a service_upsells (Módulo 5 — Panel Admin)

ALTER TABLE service_upsells
ADD COLUMN IF NOT EXISTS reviewed_by_admin BOOLEAN NOT NULL DEFAULT false;

-- Índice para filtrar upsells pendientes de revisión
CREATE INDEX IF NOT EXISTS idx_service_upsells_reviewed
ON service_upsells(reviewed_by_admin)
WHERE reviewed_by_admin = false;

-- Migración Módulo 1 — Consentimiento separado para fotos de marketing
-- Cierra hallazgo de auditoría: el spec pide 4 consentimientos separados;
-- faltaba el de "Fotos Marketing".

-- ============================================================
-- 1. Extender cotizaciones
-- ============================================================
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS consent_photo_marketing BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS photo_marketing_version TEXT NOT NULL DEFAULT 'v1.0';

-- ============================================================
-- 2. Extender perfiles de cliente para preferencia persistente
-- ============================================================
ALTER TABLE client_profiles
  ADD COLUMN IF NOT EXISTS consent_photo_marketing BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS photo_marketing_version TEXT NOT NULL DEFAULT 'v1.0';

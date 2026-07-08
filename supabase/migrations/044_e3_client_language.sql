-- ============================================================
-- E3 RETROFIT — Idioma de la cuenta del cliente (v8.3, M0 Fase 0.4)
-- Detectado en auditoría E3: el match de idioma del despacho (invariante
-- B.2.13) era inimplementable porque la cuenta del cliente no tenía campo
-- de idioma. Ordenados por prioridad; default inglés.
-- La captura en onboarding/cotizador se agrega en la fase de UI de E3.
-- ============================================================
ALTER TABLE client_profiles
  ADD COLUMN IF NOT EXISTS preferred_languages TEXT[] NOT NULL DEFAULT ARRAY['en'];

COMMENT ON COLUMN client_profiles.preferred_languages IS
  'v8.3 M0-F0.4: idiomas de la cuenta ordenados por prioridad (en/zh/es). El despacho exige match con el líder (B.2.13).';

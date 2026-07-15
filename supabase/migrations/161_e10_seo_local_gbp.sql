-- v8.3 E10.3 — SEO local + Google Business Profile
--
-- El plan (D.10.3) pide un checklist operativo, no una integración con la
-- API de Google Business Profile (fuera de alcance: requiere credenciales
-- OAuth de un negocio real que no existen en este sistema). Lo que SÍ se
-- puede construir de forma honesta es:
--   1. gbp_checklist_items — checklist administrable con estado y evidencia
--      (categorías, Q&A, atributos, fotos semanales del Live Portfolio,
--      posts semanales desde el blog).
--   2. nap_consistency_checks — verificación trimestral de Name/Address/Phone
--      consistente en directorios (registro manual del admin, honesto: no
--      hay scraper de directorios en este sistema).
--
-- Ambas tablas siguen el invariante universal: deleted_at + soft delete.

CREATE TABLE IF NOT EXISTS gbp_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_key TEXT NOT NULL UNIQUE, -- ej: 'categories_complete', 'qa_answered', 'weekly_photo_post'
  label TEXT NOT NULL,
  frequency TEXT NOT NULL CHECK (frequency IN ('once', 'weekly', 'quarterly')),
  last_completed_at TIMESTAMPTZ,
  last_completed_by UUID REFERENCES auth.users(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS nap_consistency_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  checked_by UUID REFERENCES auth.users(id),
  directories_checked TEXT[] NOT NULL DEFAULT '{}', -- ej: ['Google Business Profile', 'Yelp', 'Bing Places']
  inconsistencies_found TEXT,
  is_consistent BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

ALTER TABLE gbp_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE nap_consistency_checks ENABLE ROW LEVEL SECURITY;

-- Solo admins (via service role en la API); no hay acceso de cliente ni empleado.
CREATE POLICY gbp_checklist_admin_only ON gbp_checklist_items
  FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY nap_checks_admin_only ON nap_consistency_checks
  FOR ALL USING (false) WITH CHECK (false);

CREATE TRIGGER prevent_hard_delete_gbp_checklist_items
  BEFORE DELETE ON gbp_checklist_items
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

CREATE TRIGGER prevent_hard_delete_nap_consistency_checks
  BEFORE DELETE ON nap_consistency_checks
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

-- Semilla: los 4 ítems base del plan v8.3 D.10.3
INSERT INTO gbp_checklist_items (item_key, label, frequency) VALUES
  ('categories_attributes_complete', 'Categorías y atributos completos en Google Business Profile', 'once'),
  ('qa_answered', 'Preguntas y respuestas (Q&A) del perfil respondidas', 'weekly'),
  ('weekly_live_portfolio_photo', 'Publicar foto semanal desde el Live Portfolio aprobado', 'weekly'),
  ('weekly_blog_post', 'Publicar post semanal derivado del blog (con aprobación de un toque)', 'weekly')
ON CONFLICT (item_key) DO NOTHING;

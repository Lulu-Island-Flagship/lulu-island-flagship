-- Migración 061 — v8.3 E10 (D.10.7): contenido educativo (blog). Estructura
-- de posts + flujo de aprobación de un toque + log inmutable de validación
-- PIPA. El generador de texto con IA real NO vive aquí — `content` nace
-- vacío y lo llena un paso posterior (integración pagada, fuera de alcance).

-- ============================================================
-- 1. Posts del blog
-- ============================================================
CREATE TABLE IF NOT EXISTS blog_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '', -- vacío hasta que el generador (fuera de alcance) lo llene
  source_trigger_type TEXT NOT NULL, -- ej. 'recurring_stain_pattern', 'seasonal_demand'
  source_sample_size INTEGER NOT NULL DEFAULT 0 CHECK (source_sample_size >= 0),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_approval', 'approved', 'published', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_blog_posts_status ON blog_posts(status) WHERE deleted_at IS NULL;

ALTER TABLE blog_posts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins manage blog posts" ON blog_posts;
CREATE POLICY "admins manage blog posts" ON blog_posts
  FOR ALL USING (has_admin_role(auth.uid(), ARRAY['owner_admin','ops_coordinator']))
  WITH CHECK (has_admin_role(auth.uid(), ARRAY['owner_admin','ops_coordinator']));

DROP TRIGGER IF EXISTS trg_prevent_delete ON blog_posts;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON blog_posts
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

-- ============================================================
-- 2. Log inmutable de validación PIPA. Cubre blog Y posts de redes /
--    cualquier pieza de marketing (criterio de aceptación E10: "TODA pieza
--    de marketing generada pasa el validador"): una tabla compartida en vez
--    de duplicar el log por tipo de contenido. `content_ref` es libre
--    (id de blog_posts, de un post social futuro, etc.) — esta tabla no
--    tiene FK porque debe servir a cualquier tipo de pieza, presente o
--    futura, sin migración nueva cada vez.
-- ============================================================
CREATE TABLE IF NOT EXISTS marketing_pipa_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_type TEXT NOT NULL, -- ej. 'blog_post', 'social_post', 'campaign_copy'
  content_ref UUID, -- id de la pieza validada, si aplica
  passed BOOLEAN NOT NULL,
  violations JSONB NOT NULL DEFAULT '[]'::jsonb,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pipa_checks_failed
  ON marketing_pipa_checks(checked_at) WHERE passed = false;

ALTER TABLE marketing_pipa_checks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins read pipa checks" ON marketing_pipa_checks;
CREATE POLICY "admins read pipa checks" ON marketing_pipa_checks
  FOR SELECT USING (has_admin_role(auth.uid(), ARRAY['owner_admin','ops_coordinator']));
-- INSERT lo hace el service role desde el backend (evaluatePostForApproval
-- corre server-side); no hay policy de INSERT para roles de usuario.

-- Log inmutable de verdad: ni siquiera soft-delete, es evidencia de auditoría.
DROP TRIGGER IF EXISTS trg_prevent_delete ON marketing_pipa_checks;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON marketing_pipa_checks
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

COMMENT ON TABLE blog_posts IS
  'v8.3 E10: flujo de blog con aprobación de un toque (blog-content.ts). content vacío hasta generador real.';
COMMENT ON TABLE marketing_pipa_checks IS
  'v8.3 E10: log inmutable de CADA validación PIPA corrida (pipa-validator.ts), cualquier tipo de contenido de marketing. Evidencia de cumplimiento B.2.20.';

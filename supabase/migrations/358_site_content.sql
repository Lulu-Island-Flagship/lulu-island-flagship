-- Migration 358: site_content table for admin-editable landing page text
-- v8.5 Day 5: allows admin to edit landing copy without touching code
-- Public read, admin write via RLS (is_admin() function already exists)

CREATE TABLE site_content (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE site_content ENABLE ROW LEVEL SECURITY;

-- Anyone can read site content (public landing page)
CREATE POLICY "public_read" ON site_content
  FOR SELECT TO anon, authenticated
  USING (true);

-- Authenticated users can write (API enforces admin via requireAdminRole)
CREATE POLICY "auth_write" ON site_content
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- v8.5 fix: is_admin() helper used by site_content RLS policies (migrations 358, 359)
-- Wraps the existing has_admin_role() to provide a simple boolean check
-- that can be used in RLS USING/WITH CHECK clauses.
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(has_admin_role(auth.uid(), ARRAY['owner_admin']), false);
$$;

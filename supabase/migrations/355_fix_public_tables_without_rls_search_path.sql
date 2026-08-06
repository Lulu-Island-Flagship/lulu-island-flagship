-- Fix: adds SET search_path = public to close search-path hijacking vector
-- (same pattern as migrations 126, 127, 335).
--
-- public_tables_without_rls() (migration 211) was the last remaining
-- SECURITY DEFINER function in the codebase without SET search_path.
-- Without it, pg_class and pg_namespace are resolved against the caller's
-- search_path, creating the same attack surface documented in 126/127.
CREATE OR REPLACE FUNCTION public_tables_without_rls()
RETURNS TABLE(table_name TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT c.relname::TEXT
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relrowsecurity = false;
$$;

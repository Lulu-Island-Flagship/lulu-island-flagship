-- Migration 342: Revoke anon default privileges
--
-- Migration 125 inadvertently granted default privileges to anon for all new
-- tables (SELECT, INSERT, UPDATE, DELETE) and sequences (USAGE, SELECT).
-- Migration 317 revoked existing table SELECT grants and revoked SELECT
-- default privilege on tables from anon, but left INSERT, UPDATE, DELETE on
-- tables and USAGE, SELECT on sequences as active default privileges.
-- Any new table created in public would automatically inherit full CRUD for
-- the anonymous role.
--
-- This migration revokes ALL remaining default privileges for anon across
-- tables, sequences, functions, and routines, closing that window for all
-- future objects.

DO $$
BEGIN
  ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON ROUTINES FROM anon;
END;
$$;

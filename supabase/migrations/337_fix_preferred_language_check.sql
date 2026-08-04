-- Fix: M4 [MEDIUM] Remove 'es' from preferred_language CHECK
-- The clients table (269_client_module_clients.sql) includes 'es' (Spanish)
-- in the preferred_language CHECK constraint, but it is not a supported
-- language in the system. Drop and recreate with only 'en', 'fr', 'zh'.

ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_preferred_language_check;

ALTER TABLE clients ADD CONSTRAINT clients_preferred_language_check
  CHECK (preferred_language IN ('en', 'fr', 'zh'));

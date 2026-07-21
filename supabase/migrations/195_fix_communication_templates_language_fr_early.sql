-- Fix (bug preexistente, no introducido hoy): 205_e0_employee_invited_fr_template.sql
-- inserta ('employee_invited', 'fr', 1, ...) en communication_templates, pero
-- el CHECK original de 045_e6_communications.sql solo permite ('en','zh','es').
--
-- La migración 206_e0_retire_spanish_locale_and_rls.sql SÍ angosta ese CHECK
-- a ('en','zh','fr') -- pero corre numéricamente DESPUÉS de 205, así que en
-- un `supabase db reset` desde cero, 205 falla antes de que 206 llegue a
-- ejecutarse. El propio comentario de 206 (líneas 14-18) diagnostica
-- correctamente el problema (B-1, auditoría implacable 2026-07-20b) pero la
-- migración que lo resuelve quedó numerada en el orden equivocado para
-- efectivamente resolverlo.
--
-- Esta migración corre antes de 205 y solo AGREGA 'fr' al dominio permitido
-- (sin quitar 'es' todavía -- eso lo sigue haciendo 206, después de migrar
-- en sitio todas las filas 'es' existentes a 'fr'; quitar 'es' aquí haría
-- fallar el ADD CONSTRAINT contra las filas 'es' que migraciones anteriores
-- a esta ya insertaron). Es un superset temporal ('en','zh','es','fr') hasta
-- que 206 hace la limpieza de datos y angosta a la lista final.
ALTER TABLE communication_templates
  DROP CONSTRAINT IF EXISTS communication_templates_language_check;

ALTER TABLE communication_templates
  ADD CONSTRAINT communication_templates_language_check
  CHECK (language IN ('en', 'zh', 'es', 'fr'));

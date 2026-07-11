-- v8.3 E0 — Restaura los privilegios base de tabla para anon/authenticated/
-- service_role en todo el esquema public.
--
-- HALLAZGO REAL (verificación visual, 2026-07-11): tras reinstalar el CLI de
-- Supabase (npx instaló supabase@2.109.1 en medio de una sesión de debugging
-- de Docker), un `supabase db reset` dejó de aplicar los GRANT de base que
-- Supabase normalmente concede a anon/authenticated/service_role al crear
-- una tabla. El síntoma: TODAS las tablas (no solo admin_roles) quedaban con
-- SELECT/INSERT/UPDATE/DELETE únicamente para el rol 'postgres' -- ni
-- siquiera 'service_role' los tenía. RLS seguía intacto (las políticas ya
-- existentes no cambiaron), pero sin el GRANT base ninguna fila era
-- alcanzable sin importar la política, resultando en errores reales de
-- Postgres tipo "permission denied for table X" (visto primero en
-- src/lib/admin.ts -> requireAdminRole() al consultar admin_roles).
--
-- Este GRANT es exactamente el que Supabase aplica por defecto al crear el
-- proyecto; no otorga NADA que RLS no siga filtrando fila por fila. Es
-- idempotente -- correrlo de nuevo no rompe nada -- así que sobrevive a
-- futuros `db reset` sin importar qué versión del CLI se use, porque ahora
-- es una migración versionada, no un paso manual del bootstrap del CLI.

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated, service_role;

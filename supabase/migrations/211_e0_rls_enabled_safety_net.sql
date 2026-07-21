-- v8.3 fix C-H10 (auditoría RBAC/compliance 2026-07-21)
--
-- HALLAZGO: `anon` conserva SELECT sobre TODAS las tablas presentes y
-- futuras de `public` (125:22 -- la 129 solo revocó INSERT/UPDATE/DELETE).
-- Hoy eso está contenido porque toda tabla tiene RLS habilitado, pero el
-- propio comentario de la migración 128 admite que "ya pasó dos veces" que
-- se olvidó `ENABLE ROW LEVEL SECURITY` en una tabla nueva -- y cuando eso
-- pasa, el GRANT SELECT global de la 125 deja de estar contenido por nada.
--
-- No se estrecha el SELECT de `anon` aquí: la app depende de lecturas
-- públicas legítimas vía anon key en varias rutas (portafolio en vivo
-- aprobado, contenido de blog, etc.), y revocarlo en bloque sin poder
-- ejecutar la suite de rutas en este entorno es más riesgoso que el propio
-- hallazgo, que además el informe describe como "hoy contenido por RLS", no
-- como una fuga activa. En vez de eso, este fix cierra el MODO DE FALLO real
-- que ya ocurrió dos veces: cualquier tabla de `public` sin RLS habilitado
-- queda, a partir de aquí, con RLS forzado -- fail-closed (sin políticas
-- definidas, ninguna fila es alcanzable salvo para el dueño de la tabla /
-- service_role, que en Supabase bypassea RLS por diseño). Es idempotente y
-- no requiere conocer los nombres de tablas futuras: corre sobre
-- `pg_tables` en el momento de aplicarse.
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity = false
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.table_name);
    RAISE NOTICE 'v8.3 fix C-H10: RLS estaba deshabilitado en public.% -- habilitado (fail-closed)', t.table_name;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- Red de seguridad hacia adelante: función que cualquier chequeo de salud /
-- cron de auditoría (fuera de alcance de este fix) puede invocar para
-- detectar el mismo olvido en el futuro sin tener que enumerar tablas a
-- mano.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public_tables_without_rls()
RETURNS TABLE(table_name TEXT)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT c.relname::TEXT
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relrowsecurity = false;
$$;

COMMENT ON FUNCTION public_tables_without_rls() IS
  'v8.3 fix C-H10: lista tablas de public sin RLS habilitado. Debe devolver siempre 0 filas; úsese en un healthcheck para detectar el olvido antes de que llegue a producción.';

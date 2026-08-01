-- Fix (auditoría en vivo 2026-08-01, prueba E2E como cliente real en producción):
-- la página de cliente "My Services" (/en/cuenta/servicios) fallaba en vivo con el
-- error real de PostgREST:
--   "Could not find a relationship between 'orders' and 'quote_id' in the schema cache"
--
-- Causa raíz: src/app/api/client/orders/route.ts hace un embed de Supabase
--   quotes:quote_id (service_category, service_subtype, service_type, address, zone, total)
-- PostgREST solo puede resolver ese embed si existe una FOREIGN KEY real entre
-- orders.quote_id y quotes.id en pg_constraint -- no basta con que la columna
-- exista y tenga el nombre correcto.
--
-- Se revisó la migración base (001_modulo1_base_schema.sql): orders.quote_id se
-- declaró como "UUID NOT NULL" desde el inicio, SIN "REFERENCES quotes(id)". La
-- única constraint agregada después sobre esa columna fue un UNIQUE
-- (orders_quote_id_unique, en 019_modulo1_rls_insert_update_quotes_orders.sql),
-- nunca una FOREIGN KEY. No es una regresión de un rename reciente: es un vacío
-- que existe desde la migración fundacional. Como evidencia adicional, otras
-- rutas que sí necesitaban este join (ver 027_...) lo resolvían con SQL plano
-- (JOIN quotes q ON q.id = o.quote_id) precisamente porque la FK nunca existió
-- para poder usar el embed corto de PostgREST.
--
-- Verificación previa a este fix (antes de agregar la constraint): se confirmó
-- con una consulta en vivo contra producción que NO hay filas huérfanas
-- (orders.quote_id que no apunte a ningún quotes.id) -- 0 huérfanos -- por lo
-- que agregar la FK es segura y no requiere limpieza de datos previa.
ALTER TABLE orders
  ADD CONSTRAINT orders_quote_id_fkey
  FOREIGN KEY (quote_id) REFERENCES quotes(id);

COMMENT ON CONSTRAINT orders_quote_id_fkey ON orders IS
  'Fix 2026-08-01: agrega la FK que faltaba desde la migración base entre orders.quote_id '
  'y quotes.id. Sin esta constraint, PostgREST no puede resolver el embed '
  '"quotes:quote_id(...)" usado en src/app/api/client/orders/route.ts, y la página de '
  'cliente "My Services" fallaba en producción con "Could not find a relationship '
  'between orders and quote_id in the schema cache". Verificado 0 filas huérfanas '
  'antes de aplicar.';

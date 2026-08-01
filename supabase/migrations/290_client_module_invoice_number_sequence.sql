-- Módulo de Cliente / Facturación -- fix de numeración de facturas
-- (auditoría 2026-07-31, hallazgo #14).
--
-- Contexto del bug: invoice-service.ts (buildInvoiceNumber) usaba
-- `Date.now()` (milisegundos desde epoch) como sequenceNumber para
-- generateInvoiceNumber() (billing-calculations.ts). Esa función ya
-- documentaba explícitamente esto como limitación conocida: dos facturas
-- creadas en el mismo milisegundo bajo carga concurrente producen el mismo
-- invoice_number, lo que la UNIQUE constraint de client_invoices (276)
-- rechaza con un error 23505 poco claro -- una falla de creación de
-- factura real, no solo teórica, bajo escritura concurrente (ej. batch de
-- facturación mensual). Además, un timestamp de 13 dígitos no produce el
-- formato legible "INV-<año>-000123" que generateInvoiceNumber() espera
-- (el padStart(6, '0') no trunca, así que el número queda ilegible para
-- contabilidad).
--
-- Fix: una secuencia nativa de Postgres (`nextval()` es atómica a nivel de
-- motor -- dos transacciones concurrentes NUNCA reciben el mismo valor,
-- sin necesidad de lock explícito) expuesta a través de una función
-- SECURITY DEFINER, mismo patrón de acceso restringido que el resto de
-- funciones RPC del módulo.
--
-- Por qué una secuencia GLOBAL y no una por año: una secuencia por año
-- requeriría lógica dinámica (crear la secuencia del año N+1 la primera
-- vez que se use, manejar el rollover) -- complejidad innecesaria dado que
-- el formato ya incluye el año por separado (generateInvoiceNumber toma
-- issueDate.getUTCFullYear() del parámetro, no del secuencial). Un
-- secuencial global creciente sigue siendo único y ordenado, solo que no
-- reinicia en 1 cada enero -- comportamiento aceptable y común en sistemas
-- de facturación reales (el año en el prefijo ya identifica el período).

CREATE SEQUENCE IF NOT EXISTS client_invoice_number_seq
  AS BIGINT
  START WITH 1
  INCREMENT BY 1
  NO CYCLE;

COMMENT ON SEQUENCE client_invoice_number_seq IS
  'Módulo de Cliente / Facturación: secuencial atómico para '
  'invoice_number (INV-<año>-<secuencial>). Global, no reinicia por año -- '
  'el año va en el prefijo del número formateado, no en el secuencial. Fix '
  'hallazgo #14 (auditoría 2026-07-31): reemplaza Date.now() como fuente '
  'de sequenceNumber, que tenía riesgo real de colisión bajo carga '
  'concurrente.';

CREATE OR REPLACE FUNCTION next_client_invoice_number_sequence()
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT nextval('client_invoice_number_seq');
$$;

COMMENT ON FUNCTION next_client_invoice_number_sequence IS
  'Módulo de Cliente / Facturación: devuelve el próximo valor atómico de '
  'client_invoice_number_seq. Usado por invoice-service.ts '
  '(buildInvoiceNumber) para construir invoice_number sin condición de '
  'carrera.';

-- Mismo régimen de acceso que el resto del módulo: ni anon ni
-- authenticated pueden ejecutar esto directamente.
REVOKE ALL ON FUNCTION next_client_invoice_number_sequence FROM PUBLIC;
REVOKE ALL ON FUNCTION next_client_invoice_number_sequence FROM anon;
REVOKE ALL ON FUNCTION next_client_invoice_number_sequence FROM authenticated;
GRANT EXECUTE ON FUNCTION next_client_invoice_number_sequence TO service_role;

-- La secuencia en sí no necesita GRANT USAGE directo -- se accede
-- exclusivamente a través de la función SECURITY DEFINER de arriba, nunca
-- vía `nextval('client_invoice_number_seq')` directo desde el cliente.
REVOKE ALL ON SEQUENCE client_invoice_number_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE client_invoice_number_seq FROM anon;
REVOKE ALL ON SEQUENCE client_invoice_number_seq FROM authenticated;

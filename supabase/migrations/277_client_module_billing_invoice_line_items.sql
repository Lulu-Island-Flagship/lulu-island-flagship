-- Módulo de Cliente -- Facturación (3/4). `client_invoice_line_items`
-- guarda cada línea individual de una factura (269-276), típicamente una
-- por `property_services` (271) facturado en ese período, aunque también
-- admite líneas manuales (property_service_id NULL) para ajustes,
-- descuentos o cargos no ligados a un servicio recurrente.
--
-- Por qué `property_service_id` es ON DELETE SET NULL (no CASCADE ni
-- RESTRICT): si el servicio referenciado se elimina después de que la
-- factura ya fue emitida, la línea de factura ya emitida debe sobrevivir
-- intacta -- es un registro fiscal histórico (lo que se cobró en su
-- momento), no debe desaparecer (CASCADE) ni bloquear el borrado del
-- servicio (RESTRICT) simplemente por haber sido facturado alguna vez.
-- SET NULL preserva la línea con su description/amount_cents ya
-- congelados, solo pierde el enlace de trazabilidad hacia el servicio de
-- origen.
--
-- Por qué `amount_cents` es una columna explícita y no una columna
-- generada (`GENERATED ALWAYS AS (quantity * unit_price_cents) STORED`):
-- se necesita permitir ajustes manuales documentados de redondeo (ej.
-- cuando `quantity * unit_price_cents` no cierra exacto por conversión de
-- horas fraccionarias, o se aplica un ajuste puntual acordado con el
-- cliente) sin pelear contra una columna generada que Postgres recalcula
-- siempre. La responsabilidad de que `amount_cents` sea razonablemente
-- cercano a `quantity * unit_price_cents` queda en el servicio TS, no en
-- un CHECK rígido de Postgres.

CREATE TABLE IF NOT EXISTS client_invoice_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES client_invoices(id) ON DELETE CASCADE,
  -- SET NULL: la línea de factura ya emitida es un registro fiscal
  -- histórico que debe sobrevivir aunque el servicio de origen se borre
  -- después -- ver comentario de cabecera.
  property_service_id UUID REFERENCES property_services(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  -- Explícito (no columna generada) para permitir ajustes manuales
  -- documentados de redondeo -- ver comentario de cabecera.
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_invoice_line_items_invoice_id
  ON client_invoice_line_items (invoice_id);
CREATE INDEX IF NOT EXISTS idx_client_invoice_line_items_property_service_id
  ON client_invoice_line_items (property_service_id);

ALTER TABLE client_invoice_line_items ENABLE ROW LEVEL SECURITY;

-- Service-role-only, sin ninguna policy permisiva -- mismo patrón que el
-- resto de las tablas de este módulo (269-276).
DROP POLICY IF EXISTS "client_invoice_line_items no direct access" ON client_invoice_line_items;
CREATE POLICY "client_invoice_line_items no direct access" ON client_invoice_line_items
  FOR ALL USING (false) WITH CHECK (false);

COMMENT ON TABLE client_invoice_line_items IS
  'Módulo de Cliente / Facturación: líneas individuales de una factura. '
  'property_service_id es ON DELETE SET NULL -- la línea ya emitida es un '
  'registro fiscal histórico que sobrevive al borrado del servicio de '
  'origen. amount_cents es explícito (no generado) para permitir ajustes '
  'manuales documentados de redondeo. Acceso exclusivo vía service role.';

-- Módulo de Cliente -- Facturación (2/4). `client_invoices` guarda las
-- facturas emitidas a un cliente. Sigue con GST/PST separados igual que
-- el resto del sistema fiscal canadiense de este repo (gst_number /
-- pst_exemption_number en `clients`, 269).
--
-- Por qué `client_id` es ON DELETE RESTRICT y no CASCADE: las facturas
-- son registros financieros/fiscales -- deben sobrevivir para efectos de
-- auditoría y CRA/GST aunque el cliente se elimine del sistema (que de
-- todos modos, en la práctica, debería hacerse vía `status = 'churned'`
-- en `clients`, no un DELETE real). Un intento de borrar un cliente con
-- facturas asociadas debe fallar explícitamente, no arrastrar en cascada
-- un registro fiscal.
--
-- Por qué se guardan `amount_paid_cents` y `balance_due_cents` como
-- columnas propias (no derivadas de un SUM sobre `client_payments` en
-- cada lectura): permite lecturas baratas del estado de la factura sin
-- un JOIN/agregación, a costa de mantenerlas consistentes explícitamente
-- -- eso es exactamente lo que hace `record_client_payment` (278) de
-- forma atómica con row lock.

CREATE TABLE IF NOT EXISTS client_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- RESTRICT, no CASCADE: las facturas son registros financieros/fiscales
  -- que nunca deben borrarse en cascada por eliminar un cliente.
  client_id UUID REFERENCES clients(id) ON DELETE RESTRICT,
  invoice_number TEXT NOT NULL UNIQUE,
  issue_date DATE NOT NULL,
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'paid', 'partially_paid', 'overdue', 'void')),
  -- Todo monto SIEMPRE en centavos enteros, nunca float -- mismo patrón
  -- que `property_services.rate_amount_cents` (271) y el resto del
  -- sistema.
  subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0),
  gst_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (gst_amount_cents >= 0),
  pst_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (pst_amount_cents >= 0),
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  amount_paid_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_paid_cents >= 0),
  balance_due_cents INTEGER NOT NULL CHECK (balance_due_cents >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_invoices_client_id ON client_invoices (client_id);
CREATE INDEX IF NOT EXISTS idx_client_invoices_status ON client_invoices (status);

ALTER TABLE client_invoices ENABLE ROW LEVEL SECURITY;

-- Service-role-only, sin ninguna policy permisiva -- mismo patrón que el
-- resto de las tablas de este módulo (269-275).
DROP POLICY IF EXISTS "client_invoices no direct access" ON client_invoices;
CREATE POLICY "client_invoices no direct access" ON client_invoices
  FOR ALL USING (false) WITH CHECK (false);

COMMENT ON TABLE client_invoices IS
  'Módulo de Cliente / Facturación: facturas emitidas a un cliente. '
  'client_id es ON DELETE RESTRICT -- registro financiero/fiscal que '
  'nunca se borra en cascada. Todo monto en *_cents entero. '
  'amount_paid_cents/balance_due_cents se mantienen consistentes vía la '
  'función RPC atómica record_client_payment() (278). Acceso exclusivo '
  'vía service role.';

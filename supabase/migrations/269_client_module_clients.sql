-- Módulo de Cliente (quien contrata el servicio de limpieza) -- módulo
-- nuevo y separado del flujo de contratación de empleados/candidatos
-- (251-268, src/lib/hiring-flow/). Complementario pero independiente: NO
-- reutiliza ni depende de tablas de ese módulo salvo `legal_texts` (253)
-- y `system_settings` (251), que son infraestructura genérica compartida.
--
-- `clients` es la entidad raíz: quien contrata el servicio de limpieza
-- (residencial, comercial o industrial). Un cliente puede tener varias
-- propiedades (`client_properties`) y cada propiedad varios servicios
-- activos (`property_services`).
--
-- Alcance deliberadamente acotado: esta migración y las siguientes de
-- este módulo NO incluyen facturación, pagos ni tarjetas -- eso queda
-- para una fase posterior. Solo el modelo de datos de cliente/propiedad/
-- servicio/consentimiento.
--
-- Por qué el cliente no tiene fila en auth.users todavía: el acceso de
-- clientes será vía un portal aparte a futuro (fuera de alcance de esta
-- migración). Por ahora toda la tabla es accesible únicamente vía
-- service role, igual que `candidates` (257) en el módulo de empleado --
-- mismo razonamiento: PII sensible (contacto, dirección de facturación,
-- número de GST) sin auth.uid() disponible que la identifique.
--
-- Por qué `gst_number`/`pst_exemption_number` como TEXT libres y no
-- validados por formato: la validación de formato de números fiscales
-- reales de CRA/BC es responsabilidad del servicio TS (y eventualmente de
-- una integración con la CRA), no de un CHECK de Postgres -- un CHECK
-- rígido aquí rompería con datos legítimos que no anticipamos (números
-- provisionales, formatos legacy, etc.).

CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_type TEXT NOT NULL
    CHECK (client_type IN ('residential', 'commercial', 'industrial')),
  legal_name TEXT NOT NULL,
  display_name TEXT,
  email TEXT NOT NULL,
  phone_primary TEXT NOT NULL,
  phone_secondary TEXT,
  preferred_language TEXT NOT NULL DEFAULT 'en'
    CHECK (preferred_language IN ('en', 'fr', 'es', 'zh')),
  status TEXT NOT NULL DEFAULT 'lead'
    CHECK (status IN ('lead', 'onboarding', 'active', 'suspended', 'inactive', 'churned')),
  billing_address_line1 TEXT,
  billing_address_line2 TEXT,
  billing_city TEXT,
  billing_province TEXT,
  billing_postal_code TEXT,
  billing_country TEXT DEFAULT 'CA',
  gst_number TEXT,
  pst_exemption_number TEXT,
  invoice_terms TEXT
    CHECK (invoice_terms IN ('net_15', 'net_30', 'due_on_receipt', 'prepaid')),
  referral_source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clients_email ON clients (email);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients (status);

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

-- Service-role-only, sin ninguna policy permisiva: mismo patrón que
-- `candidates` (257) del módulo de empleado -- PII sin auth.uid()
-- disponible para el cliente (acceso futuro vía portal aparte, fuera de
-- alcance). Todo acceso pasa por rutas de API que usan
-- getServiceRoleClient() (src/lib/admin.ts).
DROP POLICY IF EXISTS "clients no direct access" ON clients;
CREATE POLICY "clients no direct access" ON clients
  FOR ALL USING (false) WITH CHECK (false);

COMMENT ON TABLE clients IS
  'Módulo de Cliente: quien contrata el servicio de limpieza. PII -- '
  'acceso exclusivo vía service role. El cliente no tiene fila en '
  'auth.users en este diseño; el acceso vía portal propio es una fase '
  'futura no cubierta por esta migración.';

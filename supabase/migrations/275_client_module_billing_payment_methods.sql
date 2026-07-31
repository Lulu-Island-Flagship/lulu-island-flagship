-- Módulo de Cliente -- Facturación (sección 7 del blueprint). Primera de
-- 4 migraciones (275-278) que agregan el modelo de datos de facturación:
-- métodos de pago, facturas, líneas de factura y pagos. Se apoyan en
-- `clients` (269) y `property_services` (271) ya existentes -- no se
-- edita ninguna migración previa de este módulo ni del flujo de
-- contratación (251-268).
--
-- `client_payment_methods` guarda métodos de pago tokenizados/registrados
-- por cliente (tarjeta, PAD, e-transfer, cheque, factura a crédito).
--
-- ============================================================================
-- REGLA DE SEGURIDAD DE PAGOS -- PCI-DSS SAQ-A (no negociable):
-- Este sistema NUNCA almacena el número de tarjeta completo (PAN) ni el
-- CVV, bajo ninguna circunstancia, en ninguna columna de ninguna tabla.
-- Solo se guardan (a) el token que devuelve el procesador de pagos
-- (Stripe, Moneris, PayPal, etc. -- ver `provider_token`) y (b) metadatos
-- seguros no sensibles para mostrar en UI (últimos 4 dígitos, mes/año de
-- expiración). El PAN completo y el CVV viven exclusivamente en el
-- procesador de pagos (fuera de este sistema) -- esto es lo que mantiene
-- el sistema en alcance SAQ-A (el más liviano de los cuestionarios de
-- autoevaluación PCI-DSS) en vez de requerir la infraestructura de un
-- entorno que almacena datos de tarjeta completos.
--
-- SI EN EL FUTURO ALGUIEN CONSIDERA AGREGAR UNA COLUMNA PARA GUARDAR EL
-- PAN COMPLETO, EL CVV, O CUALQUIER DATO DE TARJETA QUE PERMITA
-- RECONSTRUIRLOS, ESO ES UNA VIOLACIÓN DE SEGURIDAD GRAVE: rompe el
-- cumplimiento PCI-DSS, expone al negocio a responsabilidad legal y
-- financiera severa en caso de brecha, y requeriría re-certificación bajo
-- un SAQ mucho más estricto. No lo hagan -- usen tokenización del
-- procesador.
-- ============================================================================
--
-- Por qué `provider_token` no es NOT NULL a nivel de columna sino vía
-- CHECK condicional: `etransfer` y `cheque` no pasan por un procesador
-- que devuelva token -- para esos métodos `provider`/`provider_token` son
-- NULL legítimamente. Solo `credit_card` y `pad` (pre-authorized debit)
-- requieren tokenización, por eso el CHECK exige `provider_token` solo
-- para esos dos.

CREATE TABLE IF NOT EXISTS client_payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  method_type TEXT NOT NULL
    CHECK (method_type IN ('credit_card', 'pad', 'etransfer', 'cheque', 'invoice')),
  -- Procesador que emitió el token (ej. 'stripe', 'moneris'). NULL para
  -- métodos que no se tokenizan (etransfer, cheque, invoice a crédito).
  provider TEXT,
  -- Token opaco devuelto por el procesador -- JAMÁS el PAN. Ver regla
  -- PCI-DSS SAQ-A en el comentario de cabecera.
  provider_token TEXT,
  CHECK (method_type NOT IN ('credit_card', 'pad') OR provider_token IS NOT NULL),
  -- Metadatos seguros no sensibles, solo para mostrar en UI -- nunca el
  -- PAN completo.
  last_four TEXT CHECK (last_four IS NULL OR last_four ~ '^[0-9]{4}$'),
  expiry_month SMALLINT CHECK (expiry_month IS NULL OR expiry_month BETWEEN 1 AND 12),
  expiry_year SMALLINT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'removed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_payment_methods_client_id
  ON client_payment_methods (client_id);

-- Máximo un método por defecto activo por cliente -- índice único parcial
-- en vez de un CHECK/trigger, más simple y garantizado por Postgres.
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_payment_methods_default_per_client
  ON client_payment_methods (client_id)
  WHERE is_default AND status = 'active';

ALTER TABLE client_payment_methods ENABLE ROW LEVEL SECURITY;

-- Service-role-only, sin ninguna policy permisiva -- mismo patrón que el
-- resto de las tablas de este módulo (269-274).
DROP POLICY IF EXISTS "client_payment_methods no direct access" ON client_payment_methods;
CREATE POLICY "client_payment_methods no direct access" ON client_payment_methods
  FOR ALL USING (false) WITH CHECK (false);

COMMENT ON TABLE client_payment_methods IS
  'Módulo de Cliente / Facturación: métodos de pago por cliente. '
  'PCI-DSS SAQ-A -- NUNCA almacena PAN completo ni CVV, solo tokens del '
  'procesador (provider_token) y metadatos seguros (last_four, '
  'expiry_month/year). Agregar una columna para PAN/CVV es una violación '
  'de seguridad grave. Acceso exclusivo vía service role.';

-- Módulo de Cliente -- seed inicial de `system_settings` (tabla ya
-- existente, migración 251, compartida con el módulo de empleado -- esta
-- migración solo agrega filas nuevas, no toca la tabla ni sus filas
-- existentes) para parámetros específicos del módulo de cliente:
-- impuestos (GST/PST de BC), términos de facturación, retención de datos
-- y política de cancelación.
--
-- IMPORTANTE -- valores placeholder: las tasas de impuesto (GST/PST) y
-- demás valores de abajo son datos legales/fiscales reales que NO deben
-- inventarse como si fueran ciertos. No tengo acceso a una fuente oficial
-- confirmada (CRA / BC Ministry of Finance) en el momento de escribir
-- esta migración. TODA fila de esta migración lleva el sufijo literal
-- "[ASSUMPTION — verificar contra política real del negocio y CRA/BC
-- antes de producción]" en su `description`. NINGÚN valor de esta
-- migración debe usarse en producción (y mucho menos para calcular un
-- monto real de impuesto en una factura) sin antes verificar contra la
-- fuente oficial vigente y corregirlo vía la RPC de actualización de
-- settings correspondiente -- nunca editando esta fila de migración ya
-- aplicada.
--
-- Por qué INSERT ... ON CONFLICT (key) DO NOTHING: idempotencia -- esta
-- migración debe poder re-ejecutarse sin efecto secundario y, sobre
-- todo, no debe pisar un valor que ya haya sido corregido en producción
-- antes de que esta migración se aplique en ese entorno.

INSERT INTO system_settings (key, value, value_type, description, is_public)
VALUES
  (
    'tax_gst_rate',
    '0.05',
    'number',
    'Tasa de GST (Goods and Services Tax) federal aplicada a servicios de limpieza gravables. [ASSUMPTION — verificar contra política real del negocio y CRA/BC antes de producción]',
    false
  ),
  (
    'tax_pst_rate_bc',
    '0.07',
    'number',
    'Tasa de PST (Provincial Sales Tax) de British Columbia aplicada a servicios de limpieza gravables. [ASSUMPTION — verificar contra política real del negocio y CRA/BC antes de producción]',
    false
  ),
  (
    'tax_service_type',
    'taxable',
    'string',
    'Clasificación fiscal por defecto de los servicios de limpieza ofrecidos (taxable vs exento). [ASSUMPTION — verificar contra política real del negocio y CRA/BC antes de producción]',
    false
  ),
  (
    'invoice_due_days',
    '15',
    'number',
    'Días por defecto hasta el vencimiento de una factura de cliente cuando no aplica un invoice_terms distinto. [ASSUMPTION — verificar contra política real del negocio y CRA/BC antes de producción]',
    false
  ),
  (
    'late_fee_percentage',
    '0.015',
    'number',
    'Porcentaje de recargo por mora aplicado a facturas vencidas de clientes. [ASSUMPTION — verificar contra política real del negocio y CRA/BC antes de producción]',
    false
  ),
  (
    'retention_client_photos_months',
    '24',
    'number',
    'Meses que se retienen fotos de propiedades de clientes (cuando photos_allowed = true) antes de poder purgarse. [ASSUMPTION — verificar contra política real del negocio y CRA/BC antes de producción]',
    false
  ),
  (
    'retention_client_data_years',
    '3',
    'number',
    'Años que se retienen los datos de un cliente inactivo/churned antes de poder purgarse, sujeto a requisitos de PIPA BC. [ASSUMPTION — verificar contra política real del negocio y CRA/BC antes de producción]',
    false
  ),
  (
    'cancellation_hours_notice',
    '24',
    'number',
    'Horas de aviso previo requeridas para cancelar un servicio programado sin incurrir en cargo por cancelación tardía. [ASSUMPTION — verificar contra política real del negocio y CRA/BC antes de producción]',
    false
  ),
  (
    'late_cancellation_fee_cents',
    '5000',
    'number',
    'Monto en centavos (CAD) del cargo por cancelación fuera del plazo de aviso definido en cancellation_hours_notice. [ASSUMPTION — verificar contra política real del negocio y CRA/BC antes de producción]',
    false
  )
ON CONFLICT (key) DO NOTHING;

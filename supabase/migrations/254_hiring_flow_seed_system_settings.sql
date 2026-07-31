-- v0.4.1 (flujo de contratación) -- seed inicial de system_settings
-- (migración 251) para el módulo de contratación de candidatos.
--
-- IMPORTANTE -- valores placeholder: no tengo acceso al documento fuente
-- real "v0.4.1" con los montos fiscales/límites exactos de BC 2026 en el
-- momento de escribir esta migración. Cada fila cuyo valor NO está
-- confirmado contra una fuente oficial lleva el sufijo literal
-- "[ASSUMPTION -- verificar contra fuente oficial antes de producción]" en
-- su `description`. NINGÚN valor de esta migración debe usarse en
-- producción sin antes verificar esa fuente y, si corresponde, corregirlo
-- vía la función RPC set_system_setting() (migración 252) -- nunca
-- editando esta fila de migración ya aplicada.
--
-- Por qué INSERT ... ON CONFLICT DO NOTHING: esta migración debe ser
-- idempotente (poder re-ejecutarse sin efecto secundario) y, sobre todo,
-- no debe pisar un valor que ya haya sido corregido en producción vía
-- set_system_setting() antes de que esta migración se aplique en ese
-- entorno -- si la key ya existe, se asume que el valor vigente es más
-- confiable que el seed placeholder.

INSERT INTO system_settings (key, value, value_type, description, is_public)
VALUES
  (
    'company_name',
    'Lulu Island Flagship',
    'string',
    'Nombre legal/comercial de la empresa usado en textos del flujo de contratación (ej. reemplazo de [COMPANY_NAME] en legal_texts). [ASSUMPTION -- verificar contra fuente oficial antes de producción]',
    true
  ),
  (
    'security_code_expiry_days',
    '7',
    'number',
    'Días de validez de un código de invitación/seguridad enviado a un candidato antes de expirar. [ASSUMPTION -- verificar contra fuente oficial antes de producción]',
    false
  ),
  (
    'security_session_duration_hours',
    '24',
    'number',
    'Duración en horas de una sesión de candidato en el portal de contratación antes de requerir volver a autenticarse. [ASSUMPTION -- verificar contra fuente oficial antes de producción]',
    false
  ),
  (
    'security_max_file_size_mb',
    '10',
    'number',
    'Tamaño máximo en MB permitido para archivos subidos por el candidato (ej. documentos de identidad, certificados). [ASSUMPTION -- verificar contra fuente oficial antes de producción]',
    false
  ),
  (
    'security_image_compression_target_mb',
    '2',
    'number',
    'Tamaño objetivo en MB al que se comprimen imágenes subidas por el candidato antes de almacenarse. [ASSUMPTION -- verificar contra fuente oficial antes de producción]',
    false
  ),
  (
    'security_rate_limit_validation',
    '5',
    'number',
    'Máximo de intentos de validación (ej. código de seguridad) permitidos por candidato en la ventana de rate limit del endpoint correspondiente. [ASSUMPTION -- verificar contra fuente oficial antes de producción]',
    false
  ),
  (
    'worksafebc_registration_deadline_days',
    '30',
    'number',
    'Días desde la fecha de inicio del empleado dentro de los cuales debe completarse su registro ante WorkSafeBC. [ASSUMPTION -- verificar contra fuente oficial antes de producción]',
    false
  ),
  (
    'worksafebc_reminder_days_before',
    '7',
    'number',
    'Días antes del vencimiento de worksafebc_registration_deadline_days en los que se dispara un recordatorio. [ASSUMPTION -- verificar contra fuente oficial antes de producción]',
    false
  ),
  (
    'retention_rejected_months',
    '12',
    'number',
    'Meses que se retiene la información de un candidato rechazado antes de poder purgarse. [ASSUMPTION -- verificar contra fuente oficial antes de producción, incluyendo requisitos de PIPA BC]',
    false
  ),
  (
    'retention_employee_payroll_years',
    '7',
    'number',
    'Años que se retienen los registros de nómina de un empleado contratado, por requisitos de retención de registros. [ASSUMPTION -- verificar contra fuente oficial antes de producción]',
    false
  ),
  (
    'tax_year',
    '2026',
    'number',
    'Año fiscal vigente usado por el módulo de contratación para calcular retenciones y montos aplicables. [ASSUMPTION -- verificar contra fuente oficial antes de producción]',
    false
  ),
  (
    'tax_federal_basic_personal_amount',
    '15705',
    'number',
    'Monto personal básico federal (CAD) usado en cálculos de retención de impuestos para el año fiscal configurado. [ASSUMPTION -- valor placeholder, NO confirmado contra la fuente oficial de CRA para 2026 -- verificar contra fuente oficial antes de producción]',
    false
  ),
  (
    'payroll_min_wage_bc',
    '17.85',
    'number',
    'Salario mínimo por hora (CAD) de British Columbia usado para validar ofertas/nómina del flujo de contratación. [ASSUMPTION -- valor placeholder, NO confirmado contra la fuente oficial de BC Employment Standards para 2026 -- verificar contra fuente oficial antes de producción]',
    false
  )
ON CONFLICT (key) DO NOTHING;

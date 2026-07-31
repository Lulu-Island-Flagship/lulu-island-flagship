-- Módulo de Cliente -- seed inicial de `legal_texts` (tabla ya
-- existente, migración 253, compartida con el módulo de empleado -- esta
-- migración solo agrega filas nuevas, no toca la tabla ni sus filas
-- existentes) con los textos legales v1.0 que necesita el módulo de
-- cliente: acuerdo de servicio, consentimiento PIPA, consentimiento de
-- fotos, política de manejo de llaves, política de cancelación y
-- responsabilidad por daños. Todos se marcan is_active = true porque son
-- la única versión existente y deben quedar activos desde que se aplica
-- esta migración.
--
-- IMPORTANTE -- contenido placeholder: el contenido real de estos textos
-- (redacción legal final, alcance exacto de cada política) debe venir de
-- asesoría legal, que no tengo disponible en el momento de escribir esta
-- migración. El contenido de abajo es un placeholder ESTRUCTURAL
-- explícito -- incluye marcadores como [COMPANY_NAME],
-- [CANCELLATION_HOURS_NOTICE] y [LATE_CANCELLATION_FEE] que el servicio
-- TS debe resolver en runtime contra system_settings (company_name,
-- cancellation_hours_notice, late_cancellation_fee_cents) -- y el
-- marcador literal "[CONTENIDO ESTRUCTURAL PLACEHOLDER — PENDIENTE DE
-- REDACCIÓN LEGAL REAL, NO USAR EN PRODUCCIÓN]" en cada texto. NINGUNO
-- de estos textos debe mostrarse a un cliente real ni usarse para
-- recabar un consentimiento vinculante sin revisión legal previa.
--
-- Por qué ON CONFLICT (key, version) DO NOTHING: idempotencia -- si esta
-- migración se re-ejecuta, o si una versión v1.0 ya fue insertada por
-- otro medio, no se pisa contenido existente. No se toca is_active en el
-- conflicto: activar/desactivar versiones es responsabilidad exclusiva de
-- una operación administrativa explícita, nunca de un side effect de
-- esta migración.

INSERT INTO legal_texts (key, version, content, is_active, effective_from)
VALUES
  (
    'client_service_agreement',
    'v1.0',
    E'Acuerdo de Servicio de Limpieza\n\n'
    '[CONTENIDO ESTRUCTURAL PLACEHOLDER — PENDIENTE DE REDACCIÓN LEGAL REAL, NO USAR EN '
    'PRODUCCIÓN]\n\n'
    'Este acuerdo describe los términos bajo los cuales [COMPANY_NAME] presta servicios de '
    'limpieza al cliente, incluyendo alcance del servicio, condiciones de pago y '
    'responsabilidades de ambas partes.',
    true,
    now()
  ),
  (
    'client_pipa_consent',
    'v1.0',
    E'Aviso y Consentimiento de Privacidad -- Personal Information Protection Act (PIPA), '
    'British Columbia\n\n'
    '[CONTENIDO ESTRUCTURAL PLACEHOLDER — PENDIENTE DE REDACCIÓN LEGAL REAL, NO USAR EN '
    'PRODUCCIÓN]\n\n'
    '[COMPANY_NAME] recopila, usa y divulga tu información personal (datos de contacto, '
    'dirección de la propiedad, información de facturación) únicamente para los fines de '
    'prestar el servicio de limpieza contratado, de acuerdo con la Personal Information '
    'Protection Act (PIPA) de British Columbia.',
    true,
    now()
  ),
  (
    'client_photo_consent',
    'v1.0',
    E'Consentimiento para Fotografía de la Propiedad\n\n'
    '[CONTENIDO ESTRUCTURAL PLACEHOLDER — PENDIENTE DE REDACCIÓN LEGAL REAL, NO USAR EN '
    'PRODUCCIÓN]\n\n'
    'Al aceptar este consentimiento, autorizas a [COMPANY_NAME] a tomar fotografías de tu '
    'propiedad antes, durante y/o después del servicio de limpieza, con fines de control de '
    'calidad y/o promocionales. Este consentimiento es opcional y puede revocarse en '
    'cualquier momento; por defecto, ninguna propiedad se fotografía sin esta autorización '
    'explícita.',
    true,
    now()
  ),
  (
    'client_key_handling_policy',
    'v1.0',
    E'Política de Manejo de Llaves y Códigos de Acceso\n\n'
    '[CONTENIDO ESTRUCTURAL PLACEHOLDER — PENDIENTE DE REDACCIÓN LEGAL REAL, NO USAR EN '
    'PRODUCCIÓN]\n\n'
    'Esta política describe cómo [COMPANY_NAME] recibe, almacena, usa y devuelve llaves, '
    'códigos de acceso u otros medios de ingreso a la propiedad del cliente que sean '
    'necesarios para prestar el servicio.',
    true,
    now()
  ),
  (
    'client_cancellation_policy',
    'v1.0',
    E'Política de Cancelación\n\n'
    '[CONTENIDO ESTRUCTURAL PLACEHOLDER — PENDIENTE DE REDACCIÓN LEGAL REAL, NO USAR EN '
    'PRODUCCIÓN]\n\n'
    'El cliente puede cancelar un servicio programado sin cargo con al menos '
    '[CANCELLATION_HOURS_NOTICE] horas de aviso previo. Las cancelaciones fuera de ese '
    'plazo pueden estar sujetas a un cargo por cancelación tardía de [LATE_CANCELLATION_FEE].',
    true,
    now()
  ),
  (
    'client_damage_liability',
    'v1.0',
    E'Política de Responsabilidad por Daños\n\n'
    '[CONTENIDO ESTRUCTURAL PLACEHOLDER — PENDIENTE DE REDACCIÓN LEGAL REAL, NO USAR EN '
    'PRODUCCIÓN]\n\n'
    'Esta política describe el proceso y los límites de responsabilidad de [COMPANY_NAME] '
    'en caso de daño accidental a la propiedad o pertenencias del cliente durante la '
    'prestación del servicio de limpieza.',
    true,
    now()
  )
ON CONFLICT (key, version) DO NOTHING;

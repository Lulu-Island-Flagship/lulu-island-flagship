-- v0.4.1 (flujo de contratación) -- seed inicial de legal_texts
-- (migración 253): primera versión (v1.0) de los dos textos legales que
-- necesita el flujo de contratación desde el día uno -- el aviso PIPA
-- (paso 1, antes de que el candidato entregue cualquier dato personal) y
-- el consentimiento para verificación de antecedentes (CRC -- Criminal
-- Record Check). Ambos se marcan is_active = true porque son la única
-- versión existente y deben quedar activos desde que se aplica esta
-- migración.
--
-- IMPORTANTE -- contenido placeholder: el contenido real de estos textos
-- (redacción legal final, alcance exacto del consentimiento CRC, etc.)
-- debe venir de asesoría legal/el documento fuente v0.4.1, que no tengo
-- disponible. El contenido de abajo es un placeholder estructural
-- (incluye el marcador [COMPANY_NAME], resuelto en runtime por el
-- servicio TS contra system_settings.company_name) -- NO debe usarse en
-- producción sin revisión legal.
--
-- Por qué ON CONFLICT (key, version) DO NOTHING: idempotencia -- si esta
-- migración se re-ejecuta, o si una versión v1.0 ya fue insertada por
-- otro medio, no se pisa contenido existente. No se toca is_active en el
-- conflicto: activar/desactivar versiones es responsabilidad exclusiva de
-- una operación administrativa explícita (fuera de alcance de un seed),
-- nunca de un side effect de esta migración.

INSERT INTO legal_texts (key, version, content, is_active, effective_from)
VALUES
  (
    'pipa_step1',
    'v1.0',
    E'Aviso de Privacidad -- Personal Information Protection Act (PIPA), British Columbia\n\n'
    '[COMPANY_NAME] recopila, usa y divulga tu información personal únicamente para los '
    'fines del proceso de contratación al que estás aplicando, de acuerdo con la Personal '
    'Information Protection Act (PIPA) de British Columbia.\n\n'
    '[PLACEHOLDER -- CONTENIDO ESTRUCTURAL, PENDIENTE DE REVISIÓN LEGAL. No usar en '
    'producción sin validar contra el documento fuente v0.4.1 y asesoría legal.]',
    true,
    now()
  ),
  (
    'crc_consent',
    'v1.0',
    E'Consentimiento para Verificación de Antecedentes Penales (Criminal Record Check)\n\n'
    'Al continuar, autorizas a [COMPANY_NAME] a solicitar y recibir los resultados de una '
    'verificación de antecedentes penales (Criminal Record Check) como parte de este '
    'proceso de contratación, en la medida permitida por la ley aplicable de British '
    'Columbia.\n\n'
    '[PLACEHOLDER -- CONTENIDO ESTRUCTURAL, PENDIENTE DE REVISIÓN LEGAL. No usar en '
    'producción sin validar contra el documento fuente v0.4.1 y asesoría legal.]',
    true,
    now()
  )
ON CONFLICT (key, version) DO NOTHING;

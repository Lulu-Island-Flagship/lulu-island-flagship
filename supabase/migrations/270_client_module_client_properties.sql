-- Módulo de Cliente -- `client_module_properties` guarda cada propiedad
-- (residencial o comercial) sobre la que un `clients` (269) contrata
-- servicio de limpieza. Un cliente puede tener varias propiedades (ej.
-- una empresa de gestión de condominios con varios edificios, o una
-- familia con casa principal + cabaña).
--
-- [FIX 2026-07-31] Nombre de tabla renombrado de `client_properties` a
-- `client_module_properties` justo antes de aplicar esta migración a
-- producción por primera vez (nunca llegó a desplegarse con el nombre
-- original -- `db push` falló en el intento, ver commit de este cambio):
-- ya existía una tabla `client_properties` COMPLETAMENTE DISTINTA desde
-- la migración 001 (Módulo 1, cotizador B2C -- columnas
-- client_profile_id/nickname/address/zone, sin relación alguna con este
-- módulo). Renombrar aquí evita la colisión sin tocar la tabla legacy
-- (usada activamente por StepAddress.tsx, /api/quote, /api/client/properties,
-- entre otros) -- ver comentario equivalente en 271 (property_services).
--
-- Por qué `client_id` es ON DELETE CASCADE (a diferencia de
-- `position_id` en `candidates`, que es RESTRICT): una propiedad no tiene
-- valor de auditoría/legal independiente del cliente que la posee -- si
-- el cliente se borra (caso excepcional, ej. limpieza de datos por
-- solicitud PIPA), sus propiedades deben borrarse con él. Los
-- consentimientos (`client_consents`, 272) sí cuelgan de `client_id`
-- directamente y no de la propiedad, precisamente para que el registro
-- legal de consentimiento no dependa del ciclo de vida de una propiedad
-- específica.
--
-- Por qué `photos_allowed` default false: fotografiar una propiedad
-- (antes/después de limpieza, para control de calidad o marketing)
-- requiere opt-in explícito del cliente, no opt-out -- bajo PIPA de BC no
-- se asume consentimiento para capturar imágenes de la propiedad/
-- pertenencias de alguien. El default seguro es NO fotografiar hasta que
-- el cliente lo autorice explícitamente (flujo de consentimiento fuera
-- de alcance de esta migración -- se resolverá vía `client_consents`,
-- consent_type = 'photo_consent').
--
-- Por qué `province` tiene default 'BC': el negocio opera en British
-- Columbia; se deja como columna editable (no hardcodeada) por si en el
-- futuro se expande a otra provincia, pero el default refleja la
-- operación actual.

CREATE TABLE IF NOT EXISTS client_module_properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  property_name TEXT,
  property_type TEXT NOT NULL
    CHECK (property_type IN ('house', 'condo', 'townhouse', 'office', 'retail', 'warehouse', 'construction_site')),
  address_line1 TEXT NOT NULL,
  address_line2 TEXT,
  city TEXT NOT NULL,
  province TEXT NOT NULL DEFAULT 'BC',
  postal_code TEXT NOT NULL,
  geo_lat NUMERIC,
  geo_lng NUMERIC,
  access_instructions TEXT,
  cleaning_instructions TEXT,
  sq_ft INTEGER CHECK (sq_ft IS NULL OR sq_ft > 0),
  bedrooms SMALLINT,
  bathrooms NUMERIC(3,1),
  pets_info TEXT,
  parking_info TEXT,
  onsite_contact_name TEXT,
  onsite_contact_phone TEXT,
  restricted_hours TEXT,
  -- Default false a propósito: fotografiar la propiedad de alguien
  -- requiere opt-in explícito, no opt-out (PIPA BC). Ver comentario de
  -- cabecera.
  photos_allowed BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_module_properties_client_id ON client_module_properties (client_id);
CREATE INDEX IF NOT EXISTS idx_client_module_properties_status ON client_module_properties (status);

ALTER TABLE client_module_properties ENABLE ROW LEVEL SECURITY;

-- Service-role-only, sin ninguna policy permisiva -- mismo patrón que
-- `clients` (269): dirección física, instrucciones de acceso y contacto
-- in situ son datos sensibles que no deben quedar expuestos a ningún rol
-- de app directo.
DROP POLICY IF EXISTS "client_module_properties no direct access" ON client_module_properties;
CREATE POLICY "client_module_properties no direct access" ON client_module_properties
  FOR ALL USING (false) WITH CHECK (false);

COMMENT ON TABLE client_module_properties IS
  'Módulo de Cliente: propiedades de un cliente sobre las que se '
  'contrata servicio de limpieza. photos_allowed default false por '
  'opt-in explícito requerido (PIPA BC). Acceso exclusivo vía service '
  'role.';

-- Módulo de Cliente -- `property_services` guarda cada servicio de
-- limpieza activo (o histórico) contratado sobre una `client_properties`
-- (270). Una propiedad puede tener varios servicios simultáneos con
-- frecuencias distintas (ej. limpieza regular semanal + limpieza de
-- alfombras mensual).
--
-- Por qué `property_id` es ON DELETE CASCADE: igual que
-- `client_properties` -> `clients`, un servicio no tiene valor de
-- auditoría independiente de la propiedad a la que pertenece -- si la
-- propiedad se borra, sus servicios asociados dejan de tener sentido y
-- se borran con ella.
--
-- Por qué `rate_amount_cents` es INTEGER en centavos y no NUMERIC/float:
-- mismo patrón que el resto del sistema (ver comentario en migraciones
-- de payroll/pricing existentes) -- todo monto de dinero se guarda en
-- centavos enteros para evitar errores de redondeo de punto flotante.
-- El servicio TS es responsable de formatear a dólares para mostrar.
--
-- Por qué `assigned_employee_id` es UUID SIN foreign key hacia la tabla
-- de empleados del sistema principal: este módulo de cliente es
-- deliberadamente independiente del módulo de empleado/contratación
-- (251-268). Todavía no existe una tabla única y estable de "empleados
-- activos" con la que enlazar de forma segura (el flujo de contratación
-- vive en `candidates`/`hr_users`, que no son necesariamente el modelo
-- final de "empleado operativo"). Este campo es una referencia cruzada
-- INTENCIONALMENTE sin FK, a resolver en una integración final futura
-- entre módulos -- no es un olvido. Hasta entonces, la resolución de
-- integridad de este campo (que el UUID referenciado exista y sea un
-- empleado activo) es responsabilidad del servicio TS, no de Postgres.
--
-- Por qué `day_of_week` usa convención 0=domingo..6=sábado: convención
-- estándar más común (igual que `Date.getDay()` en JS/TS) -- se
-- documenta explícitamente aquí porque no hay tipo ENUM que lo autodocumente.

CREATE TABLE IF NOT EXISTS property_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID REFERENCES client_properties(id) ON DELETE CASCADE,
  service_type TEXT NOT NULL
    CHECK (service_type IN ('regular_cleaning', 'deep_cleaning', 'move_in_out', 'post_construction', 'carpet_cleaning')),
  frequency TEXT NOT NULL
    CHECK (frequency IN ('weekly', 'biweekly', 'monthly', 'one_time', 'custom')),
  -- Convención 0=domingo..6=sábado (igual que Date.getDay() en JS/TS).
  day_of_week SMALLINT CHECK (day_of_week IS NULL OR day_of_week BETWEEN 0 AND 6),
  preferred_time_start TIME,
  preferred_time_end TIME,
  estimated_duration_hours NUMERIC(4,2)
    CHECK (estimated_duration_hours IS NULL OR estimated_duration_hours > 0),
  rate_type TEXT NOT NULL
    CHECK (rate_type IN ('flat_fee', 'hourly', 'sq_ft')),
  -- SIEMPRE centavos enteros, nunca float -- mismo patrón que el resto
  -- del sistema (ver comentario en migraciones de payroll/pricing
  -- existentes).
  rate_amount_cents INTEGER NOT NULL CHECK (rate_amount_cents >= 0),
  -- Referencia cruzada INTENCIONALMENTE sin FK hacia el módulo de
  -- empleado/contratación -- ver comentario de cabecera. Se resolverá en
  -- la integración final entre módulos, no es un olvido.
  assigned_employee_id UUID,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'cancelled')),
  start_date DATE NOT NULL,
  end_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_property_services_property_id ON property_services (property_id);
CREATE INDEX IF NOT EXISTS idx_property_services_status ON property_services (status);
CREATE INDEX IF NOT EXISTS idx_property_services_assigned_employee_id ON property_services (assigned_employee_id);

ALTER TABLE property_services ENABLE ROW LEVEL SECURITY;

-- Service-role-only, sin ninguna policy permisiva -- mismo patrón que el
-- resto de las tablas de este módulo.
DROP POLICY IF EXISTS "property_services no direct access" ON property_services;
CREATE POLICY "property_services no direct access" ON property_services
  FOR ALL USING (false) WITH CHECK (false);

COMMENT ON TABLE property_services IS
  'Módulo de Cliente: servicios de limpieza activos/históricos por '
  'propiedad. rate_amount_cents siempre en centavos enteros. '
  'assigned_employee_id es una referencia cruzada intencionalmente sin '
  'FK hacia el módulo de empleado -- se resuelve en integración futura. '
  'Acceso exclusivo vía service role.';

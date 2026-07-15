-- Migración 143 — v8.3 E7 (D.10, excepción #10): "Clima adverso — Environment
-- Canada; alerta 2h antes, reagendar sin penalización; equipo no llega =
-- aborto seguro + Day Rate + reagendamiento con 20% dcto | Automático".
--
-- DISEÑO HONESTO: no existe integración contratada con Environment Canada
-- (ni credenciales). En vez de simular datos de clima falsos, esta migración
-- crea SOLO la bitácora auditable de la excepción -- el admin declara el
-- clima adverso (fuente 'manual' hoy; 'environment_canada' cuando exista el
-- adaptador real, ver src/lib/weather-provider.ts) y el sistema clasifica la
-- resolución correcta (reagendar sin penalización vs. aborto seguro + Day
-- Rate + 20% dcto) según cuánta anticipación hubo. No toca `orders` ni la
-- lógica de dispatch/zona (E4, en construcción en otra sesión) -- el
-- reagendamiento real de cada orden queda como paso humano posterior,
-- registrado aquí como evidencia de qué se decidió y por qué.

CREATE TABLE IF NOT EXISTS weather_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Fecha de servicio afectada por el clima (no necesariamente hoy: se puede
  -- declarar con anticipación si la alerta llega antes).
  affected_date DATE NOT NULL,

  condition TEXT NOT NULL, -- ej. "nevada intensa", "viento >70km/h"

  -- 'manual': el admin declaró la excepción a mano (única fuente disponible
  -- hoy). 'environment_canada': reservado para cuando exista el adaptador
  -- real (src/lib/weather-provider.ts) y pueda declarar automáticamente.
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'environment_canada')),

  -- Horas de anticipación entre la alerta y el servicio. NULL cuando el
  -- equipo ya estaba en sitio o en camino sin alerta previa (crea aborto
  -- seguro automáticamente vía el trigger de abajo).
  alert_lead_time_hours NUMERIC CHECK (alert_lead_time_hours IS NULL OR alert_lead_time_hours >= 0),

  -- 'reschedule_no_penalty': alerta >= 2h antes, se reagenda sin costo para
  -- el cliente. 'safe_abort_day_rate_discount': el equipo no pudo llegar o
  -- ya estaba en sitio -- Day Rate garantizado al empleado + reagendamiento
  -- con 20% dcto al cliente. Calculado por la aplicación (src/lib/weather-exception.ts),
  -- nunca a discreción libre del admin.
  resolution TEXT NOT NULL CHECK (resolution IN ('reschedule_no_penalty', 'safe_abort_day_rate_discount')),

  reschedule_discount_percent NUMERIC, -- 20 cuando resolution = safe_abort_day_rate_discount, NULL si no aplica

  -- Texto libre: qué órdenes/zonas se vieron afectadas. No se referencia
  -- orders.id directamente a propósito (evita tocar el flujo de dispatch/E4
  -- en construcción en otra sesión); el reagendamiento real de cada orden es
  -- un paso humano posterior fuera de esta tabla.
  affected_orders_note TEXT,

  notes TEXT,
  declared_by UUID REFERENCES employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_weather_exceptions_date ON weather_exceptions(affected_date);

ALTER TABLE weather_exceptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Supervisors read weather exceptions" ON weather_exceptions;
CREATE POLICY "Supervisors read weather exceptions" ON weather_exceptions
  FOR SELECT USING (is_supervisor(auth.uid()));

DROP POLICY IF EXISTS "Supervisors manage weather exceptions" ON weather_exceptions;
CREATE POLICY "Supervisors manage weather exceptions" ON weather_exceptions
  FOR ALL USING (is_supervisor(auth.uid())) WITH CHECK (is_supervisor(auth.uid()));

DROP TRIGGER IF EXISTS trg_prevent_delete ON weather_exceptions;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON weather_exceptions
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

COMMENT ON TABLE weather_exceptions IS
  'v8.3 E7 D.10#10: bitácora de excepciones de clima adverso. resolution se calcula con src/lib/weather-exception.ts a partir de alert_lead_time_hours, nunca a discreción libre.';

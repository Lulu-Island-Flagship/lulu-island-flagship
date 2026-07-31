-- v0.4.1 (flujo de contratación) -- Fase 2 "Modelo de Datos Completo".
-- `candidate_availability` guarda los bloques de disponibilidad horaria
-- que un candidato declara durante el flujo (para coordinar entrevistas
-- o turnos). Un candidato puede tener múltiples filas (una por bloque
-- día/hora), de ahí la relación 1-a-muchos con `candidates` (257).
--
-- Por qué `day_of_week` es SMALLINT 0-6 y no un enum de texto ('lunes',
-- etc.): 0-6 es un estándar simple e independiente de idioma/locale --
-- el mapeo a nombre de día (y a qué convención, 0=domingo vs 0=lunes) es
-- responsabilidad del servicio TS que lo formatea para mostrarlo, no de
-- la DB. Se documenta la convención (0=domingo, ISO-like con offset 0)
-- en types.ts.
--
-- Por qué ON DELETE CASCADE (a diferencia de position_id en candidates,
-- que es RESTRICT): la disponibilidad no tiene valor propio sin el
-- candidato al que pertenece -- es un detalle derivado, no un registro
-- de auditoría independiente. Si se borra un candidato (caso raro, ej.
-- solicitud de borrado de datos personales), su disponibilidad debe
-- desaparecer con él.

CREATE TABLE IF NOT EXISTS candidate_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  day_of_week SMALLINT CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME,
  end_time TIME,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_candidate_availability_candidate_id
  ON candidate_availability (candidate_id);

ALTER TABLE candidate_availability ENABLE ROW LEVEL SECURITY;

-- Service-role-only, mismo criterio que candidates (257): la
-- disponibilidad es un detalle del candidato y se accede solo vía API
-- validada por sesión, nunca directo.
DROP POLICY IF EXISTS "candidate_availability no direct access" ON candidate_availability;
CREATE POLICY "candidate_availability no direct access" ON candidate_availability
  FOR ALL USING (false) WITH CHECK (false);

COMMENT ON TABLE candidate_availability IS
  'v0.4.1 flujo de contratación: bloques de disponibilidad horaria '
  'declarados por un candidato. day_of_week: 0=domingo..6=sábado. '
  'ON DELETE CASCADE con candidates -- sin valor propio fuera del '
  'candidato. Acceso exclusivo vía service role.';

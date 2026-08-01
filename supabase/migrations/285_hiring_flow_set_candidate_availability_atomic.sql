-- v0.4.1 (flujo de contratación) -- Fase 5.1 (fix de atomicidad, post-Fase 5).
--
-- Contexto del bug que esto corrige: setCandidateAvailability()
-- (candidate-availability-service.ts) hacía DELETE de todas las filas de
-- candidate_availability del candidato y luego INSERT de las nuevas como
-- dos llamadas independientes a PostgREST vía supabase-js -- NO una
-- transacción de Postgres real. El comentario original en ese archivo ya
-- documentaba la limitación honestamente ("si el proceso muere o la
-- conexión se corta justo entre el delete y el insert, el candidato puede
-- quedar temporalmente SIN ninguna fila de disponibilidad") y la aceptaba
-- como riesgo bajo (el candidato puede simplemente reenviar su
-- disponibilidad, a diferencia de candidates+consents que sí son un
-- requisito legal duro). Se cierra esa ventana igual, siguiendo el mismo
-- patrón ya usado en 249 (set_current_fixed_costs), 252
-- (set_system_setting) y 268 (submit_step1_candidate): una función RPC
-- SECURITY DEFINER que hace DELETE + INSERT dentro de una única
-- transacción real.
--
-- Por qué NO se revalida aquí el formato de day_of_week/start_time/
-- end_time (validateAvailabilityBlock/validateAvailabilityBlocks): esta
-- función asume que el caller (setCandidateAvailability) ya corrió esa
-- validación en TS antes de invocar la RPC -- mismo criterio que
-- submit_step1_candidate asume para Step1Validator. El CHECK de columna
-- de 258 (day_of_week BETWEEN 0 AND 6) sigue siendo la última línea de
-- defensa a nivel DB, no se duplica aquí.
--
-- p_blocks llega como JSONB (array de objetos {day_of_week, start_time,
-- end_time}) en vez de arrays paralelos -- más simple de construir desde
-- supabase-js (JSON.stringify de los bloques ya validados) y más legible
-- que tres arrays posicionales que dependen de mantenerse alineados.

CREATE OR REPLACE FUNCTION set_candidate_availability(
  p_candidate_id UUID,
  p_blocks JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF p_candidate_id IS NULL THEN
    RAISE EXCEPTION 'set_candidate_availability: p_candidate_id es requerido'
      USING ERRCODE = '22023';
  END IF;

  IF p_blocks IS NULL OR jsonb_typeof(p_blocks) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'set_candidate_availability: p_blocks debe ser un array JSON (puede ser vacío)'
      USING ERRCODE = '22023';
  END IF;

  DELETE FROM candidate_availability WHERE candidate_id = p_candidate_id;

  -- Un candidato puede legítimamente enviar un array vacío ("borrar toda
  -- mi disponibilidad") -- el DELETE de arriba ya deja el estado correcto,
  -- sin insertar nada más.
  INSERT INTO candidate_availability (candidate_id, day_of_week, start_time, end_time)
  SELECT
    p_candidate_id,
    (block->>'day_of_week')::SMALLINT,
    (block->>'start_time')::TIME,
    (block->>'end_time')::TIME
  FROM jsonb_array_elements(p_blocks) AS block;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION set_candidate_availability IS
  'v0.4.1 flujo de contratación: reemplaza (DELETE + INSERT) la '
  'disponibilidad completa de un candidato en una sola transacción '
  'atómica (fix de la limitación documentada en '
  'candidate-availability-service.ts: dos llamadas separadas a '
  'PostgREST podían dejar al candidato sin ninguna fila entre el delete '
  'y el insert). p_blocks debe llegar ya validado por '
  'validateAvailabilityBlocks() en TS.';

-- Mismo régimen de acceso que el resto del módulo: ni anon ni
-- authenticated pueden ejecutar esto directamente (candidate_availability
-- es service-role-only, ver 258) -- SECURITY DEFINER solo tiene sentido
-- protegido detrás del mismo perímetro.
REVOKE ALL ON FUNCTION set_candidate_availability FROM PUBLIC;
REVOKE ALL ON FUNCTION set_candidate_availability FROM anon;
REVOKE ALL ON FUNCTION set_candidate_availability FROM authenticated;
GRANT EXECUTE ON FUNCTION set_candidate_availability TO service_role;

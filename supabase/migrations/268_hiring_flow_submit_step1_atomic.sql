-- v0.4.1 (flujo de contratación) -- Fase 4 (fix de atomicidad, post-Fase 4).
--
-- Contexto del bug que esto corrige: candidate-step1-service.ts
-- (submitStep1Application) originalmente hacía dos operaciones
-- independientes sobre PostgREST vía supabase-js -- INSERT en `candidates`
-- y, si tenía éxito, INSERT en `consents` (recordConsent()) -- sin
-- transacción real entre ambas (cada .from(...).insert(...) es su propio
-- round-trip HTTP). Se implementó un saga con compensación (si el insert
-- de consents fallaba, se intentaba borrar el candidato recién creado) que
-- funcionaba pero dejaba una ventana: si la compensación TAMBIÉN fallaba
-- (ej. caída de red justo en ese instante), quedaba un candidato sin
-- consentimiento legal registrado -- justo lo que la regla dura del plan
-- prohíbe ("nunca guardes un candidato sin consentimiento explícito").
--
-- Fix: mismo patrón ya usado en 249 (set_current_fixed_costs) y 252
-- (set_system_setting) -- una función RPC SECURITY DEFINER que hace ambos
-- INSERT dentro de una única transacción de Postgres real. Si cualquiera
-- de los dos falla, ambos se revierten -- nunca puede quedar un candidato
-- huérfano sin consentimiento, y ya no hace falta lógica de compensación
-- en la capa de aplicación (elimina por completo la clase de error
-- OrphanedCandidateError del lado TS).
--
-- Por qué el renderizado del texto legal NO pasa por esta función: leer
-- system_settings (company_name) y renderizar los placeholders del
-- template (legal-text-service.ts: renderTemplate) es lógica de
-- aplicación en TypeScript, no algo que tenga sentido reimplementar en
-- PL/pgSQL. Esta función solo recibe el resultado YA renderizado
-- (legal_text_key/version/id) como parámetros -- el renderizado ocurre
-- ANTES de llamar a esta función y no escribe nada en la DB, así que no
-- rompe la atomicidad: si renderLegalText() falla, esta función ni
-- siquiera se invoca.
--
-- Por qué NO se valida aquí de nuevo el formato de first_name/email/etc.
-- (Step1Validator): esta función asume que el caller (submitStep1Application)
-- ya corrió esa validación en TS antes de llegar aquí -- exactamente igual
-- que 249/252 asumen que el caller ya resolvió la autorización de más
-- alto nivel antes de invocar la RPC. Sí se revalida aquí, a nivel de
-- constraint de columna (ver 257_hiring_flow_candidates.sql), lo mínimo
-- irrenunciable: candidate_id no nulo, status válido, etc. -- eso ya lo
-- garantiza el CHECK existente de la tabla, no se duplica aquí.

CREATE OR REPLACE FUNCTION submit_step1_candidate(
  p_position_id UUID,
  p_first_name TEXT,
  p_last_name TEXT,
  p_email TEXT,
  p_phone TEXT,
  p_date_of_birth DATE,
  p_legal_text_key TEXT,
  p_legal_text_version TEXT,
  p_legal_text_id UUID,
  p_consent_accepted BOOLEAN,
  p_ip_address TEXT,
  p_user_agent TEXT
)
RETURNS TABLE (
  candidate_id UUID,
  consent_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_candidate_id UUID;
  v_consent_id UUID;
BEGIN
  -- Misma regla dura que consent-service.ts (buildConsentRecord): nunca
  -- se crea un candidato sin consentimiento explícito aceptado. Se
  -- revalida aquí, dentro de la transacción, en vez de confiar
  -- únicamente en el chequeo previo de submitStep1Application -- defensa
  -- en profundidad, ya que esta función es SECURITY DEFINER y podría en
  -- teoría invocarse desde otro caller en el futuro sin pasar por ese
  -- chequeo de TS.
  IF p_consent_accepted IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'submit_step1_candidate: consentAccepted debe ser true -- nunca se crea un candidato sin consentimiento explícito'
      USING ERRCODE = '22023';
  END IF;

  IF p_position_id IS NULL THEN
    RAISE EXCEPTION 'submit_step1_candidate: p_position_id es requerido'
      USING ERRCODE = '22023';
  END IF;

  IF p_ip_address IS NULL OR length(trim(p_ip_address)) = 0 THEN
    RAISE EXCEPTION 'submit_step1_candidate: p_ip_address es requerido (regla dura: todo consentimiento guarda IP)'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO candidates (
    position_id, first_name, last_name, email, phone, date_of_birth, status
  ) VALUES (
    p_position_id, p_first_name, p_last_name, p_email, p_phone, p_date_of_birth, 'step1_completed'
  )
  RETURNING id INTO v_candidate_id;

  INSERT INTO consents (
    candidate_id, legal_text_key, legal_text_version, legal_text_id, accepted, ip_address, user_agent
  ) VALUES (
    v_candidate_id, p_legal_text_key, p_legal_text_version, p_legal_text_id, p_consent_accepted, p_ip_address, p_user_agent
  )
  RETURNING id INTO v_consent_id;

  RETURN QUERY SELECT v_candidate_id, v_consent_id;
END;
$$;

COMMENT ON FUNCTION submit_step1_candidate IS
  'v0.4.1 flujo de contratación: inserta candidates + consents en una '
  'sola transacción atómica (fix del saga-con-compensación original de '
  'candidate-step1-service.ts). El texto legal ya debe venir renderizado '
  '(legal_text_key/version/id) -- esta función no lee system_settings ni '
  'legal_texts, solo persiste el resultado ya renderizado en TS.';

-- Mismo régimen de acceso que el resto del módulo: ni anon ni
-- authenticated pueden ejecutar esto directamente (candidates/consents
-- son service-role-only, ver 257/263) -- SECURITY DEFINER solo tiene
-- sentido protegido detrás del mismo perímetro. Revocamos explícito en
-- vez de confiar en el default, mismo patrón que las funciones RPC
-- previas del módulo.
REVOKE ALL ON FUNCTION submit_step1_candidate FROM PUBLIC;
REVOKE ALL ON FUNCTION submit_step1_candidate FROM anon;
REVOKE ALL ON FUNCTION submit_step1_candidate FROM authenticated;
GRANT EXECUTE ON FUNCTION submit_step1_candidate TO service_role;

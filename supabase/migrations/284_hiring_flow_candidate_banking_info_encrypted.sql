-- v0.4.1 (flujo de contratación) -- reemplaza el [WARNING] de texto plano
-- documentado en 279_hiring_flow_candidate_banking_info.sql: los datos de
-- Direct Deposit del candidato (transit/institution/account) ahora se
-- cifran en reposo con pgcrypto, siguiendo EXACTAMENTE el mismo patrón ya
-- usado y auditado para `employees.sin_encrypted`/`banking_details_encrypted`
-- (204_e9_employee_sin_banking_encrypted.sql) -- no se inventa un esquema
-- nuevo, se reutiliza uno que ya pasó revisión.
--
-- Por qué es seguro reemplazar (no solo agregar) las columnas en texto
-- plano en esta migración, a diferencia del caso general de "nunca borres
-- una columna con datos en producción": candidate_banking_info se creó en
-- 279 en esta misma sesión de trabajo y, al momento de escribir esta
-- migración, ningún endpoint de API llama todavía a
-- setCandidateDirectDeposit()/getCandidateDirectDeposit() (el panel de
-- admin de Fase 6 -- que expondría el Paso 3 del flujo -- no se ha
-- construido todavía). No hay filas reales de candidatos con datos
-- bancarios que preservar.
--
-- DISEÑO -- mismas decisiones que 204, adaptadas a que aquí NO hay un
-- admin autenticado escribiendo (a diferencia de nómina de empleados):
--   - Un solo BYTEA `banking_details_encrypted` con
--     pgp_sym_encrypt(json_build_object('transit', ..., 'institution', ...,
--     'account', ...)::text, clave) -- misma razón que 204: la tripleta
--     transit/institution/account solo tiene sentido junta.
--   - La clave de cifrado viaja como PARÁMETRO explícito (p_encryption_key),
--     nunca vía GUC/current_setting() -- misma justificación que 204
--     (rotación simple, una sola fuente de verdad: la variable de entorno
--     de servidor, ver src/lib/hiring-flow/direct-deposit-service.ts).
--   - Variable de entorno dedicada `HIRING_FLOW_ENCRYPTION_KEY`, DISTINTA
--     de `PAYROLL_ENCRYPTION_KEY` (empleados): son dominios de confianza
--     distintos (candidatos sin cuenta autenticada todavía vs. nómina de
--     empleados ya contratados) -- si una clave se filtra, el radio de
--     impacto queda limitado a una sola tabla, no a ambas.
--   - Sin `has_admin_role()` dentro de las funciones RPC: a diferencia de
--     `set_employee_banking_info`/`get_employee_banking_info` (llamadas
--     directamente por un admin autenticado vía su propio JWT), estas
--     funciones son invocadas EXCLUSIVAMENTE desde
--     direct-deposit-service.ts usando el cliente service-role (mismo
--     patrón que el resto de las tablas de este módulo, ver
--     candidate_banking_info RLS "FOR ALL USING (false)" en 279) -- el
--     candidato nunca tiene una sesión de Supabase Auth (usa el sistema de
--     códigos de acceso/sesión propio del módulo, ver access-code-service.ts/
--     session-service.ts), así que auth.uid() sería NULL de todos modos y
--     un chequeo de rol de admin no aplica aquí. La autorización real
--     ocurre en la capa TypeScript del endpoint que valide la sesión del
--     candidato ANTES de llamar a estas funciones (Fase 6, panel/endpoint
--     todavía no construido) -- documentado como [ASSUMPTION] explícita
--     para que quede claro que este RPC confía en su único llamador
--     esperado (el servicio, nunca expuesto directo a un rol público).
--
-- CONFIGURACIÓN EN PRODUCCIÓN (dueño, antes de habilitar el Paso 3 real):
--   1. Generar una clave aleatoria de 256 bits: openssl rand -base64 32
--   2. Guardarla como variable de entorno de SOLO servidor (nunca
--      NEXT_PUBLIC_, nunca commiteada a git):
--        HIRING_FLOW_ENCRYPTION_KEY=<salida de openssl rand -base64 32>
--   3. Si la clave se pierde, los datos bancarios ya cifrados quedan
--      irrecuperables por diseño (cifrado simétrico real). Guardar copia
--      offline segura es responsabilidad operativa del dueño.
--   4. Rotación: no hay mecanismo automático en este pase (mismo alcance
--      que 204) -- requeriría descifrar con la clave vieja y re-cifrar con
--      la nueva para cada candidato.

-- ============================================================
-- 1. Reemplazar columnas en texto plano por una columna cifrada
-- ============================================================
ALTER TABLE candidate_banking_info
  DROP COLUMN IF EXISTS transit_number,
  DROP COLUMN IF EXISTS institution_number,
  DROP COLUMN IF EXISTS account_number,
  ADD COLUMN IF NOT EXISTS banking_details_encrypted BYTEA,
  ADD COLUMN IF NOT EXISTS banking_info_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN candidate_banking_info.banking_details_encrypted IS
  'v0.4.1: JSON {transit, institution, account} cifrado con pgp_sym_encrypt (pgcrypto). NUNCA se lee/escribe directo -- solo vía set_candidate_banking_info()/get_candidate_banking_info(). Reemplaza las columnas en texto plano de la migración 279.';
COMMENT ON COLUMN candidate_banking_info.banking_info_updated_at IS
  'v0.4.1: última vez que set_candidate_banking_info() escribió esta columna.';

-- ============================================================
-- 2. Bloqueo de acceso directo a la columna cifrada desde clientes
--    normales (defensa en profundidad -- RLS de 279 ya bloquea anon/
--    authenticated a nivel de fila; este REVOKE bloquea a nivel de
--    columna incluso si una policy futura se relajara por error).
-- ============================================================
REVOKE SELECT (banking_details_encrypted) ON candidate_banking_info FROM anon, authenticated;
GRANT SELECT (banking_details_encrypted) ON candidate_banking_info TO service_role;

-- ============================================================
-- 3. set_candidate_banking_info() -- único punto de escritura.
-- ============================================================
CREATE OR REPLACE FUNCTION set_candidate_banking_info(
  p_candidate_id UUID,
  p_transit_number TEXT,
  p_institution_number TEXT,
  p_account_number TEXT,
  p_encryption_key TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_encryption_key IS NULL OR length(p_encryption_key) = 0 THEN
    RAISE EXCEPTION 'set_candidate_banking_info: falta la clave de cifrado (HIRING_FLOW_ENCRYPTION_KEY no configurada del lado servidor)';
  END IF;

  -- Validación de formato (defensa en profundidad -- direct-deposit-service.ts
  -- ya valida esto con validateDirectDepositInput() antes de llamar a esta
  -- función, pero la función nunca confía únicamente en el caller).
  IF p_transit_number !~ '^[0-9]{5}$' THEN
    RAISE EXCEPTION 'set_candidate_banking_info: transit number inválido -- se esperan exactamente 5 dígitos';
  END IF;
  IF p_institution_number !~ '^[0-9]{3}$' THEN
    RAISE EXCEPTION 'set_candidate_banking_info: institution number inválido -- se esperan exactamente 3 dígitos';
  END IF;
  IF p_account_number !~ '^[0-9]{7,12}$' THEN
    RAISE EXCEPTION 'set_candidate_banking_info: account number inválido -- se esperan entre 7 y 12 dígitos';
  END IF;

  INSERT INTO candidate_banking_info (candidate_id, banking_details_encrypted, banking_info_updated_at)
  VALUES (
    p_candidate_id,
    pgp_sym_encrypt(
      json_build_object(
        'transit', p_transit_number,
        'institution', p_institution_number,
        'account', p_account_number
      )::text,
      p_encryption_key
    ),
    now()
  )
  ON CONFLICT (candidate_id) DO UPDATE SET
    banking_details_encrypted = EXCLUDED.banking_details_encrypted,
    banking_info_updated_at = now(),
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION set_candidate_banking_info(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_candidate_banking_info(UUID, TEXT, TEXT, TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION set_candidate_banking_info IS
  'v0.4.1: único punto de escritura de datos bancarios cifrados del candidato. SECURITY DEFINER. La clave de cifrado se recibe como parámetro (HIRING_FLOW_ENCRYPTION_KEY del entorno de servidor). Llamada exclusivamente desde src/lib/hiring-flow/direct-deposit-service.ts con el cliente service-role -- ver [ASSUMPTION] en el comentario de cabecera de esta migración sobre por qué no hay chequeo de rol de admin aquí.';

-- ============================================================
-- 4. get_candidate_banking_info() -- único punto de lectura en texto plano.
-- ============================================================
CREATE OR REPLACE FUNCTION get_candidate_banking_info(
  p_candidate_id UUID,
  p_encryption_key TEXT
)
RETURNS TABLE (
  transit_number TEXT,
  institution_number TEXT,
  account_number TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_encrypted BYTEA;
  v_json JSONB;
BEGIN
  IF p_encryption_key IS NULL OR length(p_encryption_key) = 0 THEN
    RAISE EXCEPTION 'get_candidate_banking_info: falta la clave de cifrado (HIRING_FLOW_ENCRYPTION_KEY no configurada del lado servidor)';
  END IF;

  SELECT c.banking_details_encrypted
  INTO v_encrypted
  FROM candidate_banking_info c
  WHERE c.candidate_id = p_candidate_id;

  IF NOT FOUND OR v_encrypted IS NULL THEN
    RETURN;
  END IF;

  v_json := pgp_sym_decrypt(v_encrypted, p_encryption_key)::jsonb;

  RETURN QUERY SELECT
    v_json->>'transit',
    v_json->>'institution',
    v_json->>'account';
END;
$$;

REVOKE EXECUTE ON FUNCTION get_candidate_banking_info(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_candidate_banking_info(UUID, TEXT) TO service_role;

COMMENT ON FUNCTION get_candidate_banking_info IS
  'v0.4.1: único punto de lectura en texto plano de datos bancarios del candidato. SECURITY DEFINER. Llamada exclusivamente desde src/lib/hiring-flow/direct-deposit-service.ts con el cliente service-role. Nunca exponer su resultado a un rol público ni loguearlo en texto plano.';

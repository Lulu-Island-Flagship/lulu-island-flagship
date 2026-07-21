-- v8.3 P0-8 (auditoría externa Fable5, 2026-07-19) — SIN y datos bancarios
-- cifrados en reposo para `employees`.
--
-- HALLAZGO: la tabla employees (003_modulo3_employee_tables.sql + ~12 ALTER
-- posteriores, verificado con `grep -rln "ALTER TABLE employees"
-- supabase/migrations/*.sql`) no tenía NINGUNA columna de SIN (Social
-- Insurance Number, equivalente canadiense del SSN) ni de cuenta bancaria/
-- direct deposit. El Plan C.3 exige "SIN … direct deposit cifrado en
-- reposo y visible solo para nómina"; E9.3 exige un export con "desglose
-- SIN". Sin esto: no se puede ejecutar un pago real de nómina (direct
-- deposit) ni generar un T4 válido ante CRA (el T4 exige el SIN por ley).
--
-- DISEÑO — por qué pgcrypto (pgp_sym_encrypt/pgp_sym_decrypt):
--   Ya está disponible en el proyecto (seed.sql: `CREATE EXTENSION IF NOT
--   EXISTS pgcrypto WITH SCHEMA extensions`, `SET search_path TO public,
--   extensions`; config.toml: `extra_search_path = ["public", "extensions"]`).
--   No requiere infraestructura nueva (KMS externo, Vault de Supabase, etc.)
--   y cifra/descifra dentro de la misma transacción de Postgres -- el
--   texto plano nunca sale de la base salvo por el resultado explícito de
--   get_employee_banking_info(), llamado solo por el flujo de nómina.
--
-- DISEÑO — dos columnas BYTEA, no cuatro:
--   sin_encrypted            : el SIN por sí solo (identificador legal
--                               distinto, requerido de forma independiente
--                               para T4/T4A -- puede necesitarse sin tocar
--                               nunca los datos bancarios).
--   banking_details_encrypted: UN solo BYTEA con
--                               pgp_sym_encrypt(json_build_object('transit',
--                               ..., 'institution', ..., 'account', ...)::text,
--                               clave). Transit/institution/account SOLO
--                               tienen sentido juntos (una cuenta de direct
--                               deposit es la tripleta completa o no es
--                               nada) -- separarlos en 3 columnas BYTEA no
--                               agrega ninguna granularidad de acceso real
--                               (el flujo de nómina siempre necesita las
--                               tres a la vez) y sí agrega 3 llamadas a
--                               pgp_sym_encrypt/decrypt en vez de 1. Un solo
--                               blob JSON cifrado es más simple y con la
--                               misma seguridad (el cifrado es sobre el
--                               blob completo, no campo por campo).
--
-- DISEÑO — cómo viaja la clave de cifrado (decisión explícita, la alternativa
-- descartada fue current_setting('app.settings.payroll_encryption_key')):
--   Las funciones de abajo reciben la clave como PARÁMETRO explícito
--   (p_encryption_key), no vía current_setting()/GUC de sesión. Motivo:
--   current_setting() exige un paso de configuración adicional a nivel de
--   base de datos (ALTER DATABASE ... SET app.settings.xxx = '...', o
--   inyectarlo por variable de conexión) que vive FUERA del control de
--   versiones, es fácil de olvidar al aprovisionar un proyecto Supabase
--   nuevo (igual que ya pasó con los GRANT base, ver 125_e0_grants_base_roles.sql),
--   y no tiene un mecanismo simple de rotación. Pasar la clave como parámetro
--   mantiene una ÚNICA fuente de verdad -- la variable de entorno de servidor
--   PAYROLL_ENCRYPTION_KEY (Vercel/hosting), leída en src/lib/admin.ts o el
--   endpoint que llama al RPC -- exactamente el mismo patrón de seguridad ya
--   usado para SUPABASE_SERVICE_ROLE_KEY: un secreto server-side que nunca
--   llega al cliente, inyectado en cada llamada, nunca persistido en la
--   configuración de la base de datos ni en una columna.
--
-- CONFIGURACIÓN EN PRODUCCIÓN (dueño, antes de la primera nómina real):
--   1. Generar una clave aleatoria de 256 bits:
--        openssl rand -base64 32
--   2. Guardarla como variable de entorno de SOLO servidor (Vercel Project
--      Settings -> Environment Variables, NUNCA con prefijo NEXT_PUBLIC_,
--      NUNCA commiteada a git -- ni en .env.example ni en env.example):
--        PAYROLL_ENCRYPTION_KEY=<salida de openssl rand -base64 32>
--   3. Si la clave se pierde, los SIN/datos bancarios YA cifrados quedan
--      irrecuperables (por diseño -- es cifrado simétrico real, no un
--      "ofuscado reversible"). Guardar una copia offline segura (ej. gestor
--      de contraseñas del dueño) es responsabilidad operativa, igual que
--      cualquier llave maestra de cifrado.
--   4. Rotar la clave requiere descifrar con la clave vieja y re-cifrar con
--      la nueva para cada empleado -- no hay mecanismo automático de
--      rotación en este pase (fuera de alcance; documentado como pendiente).
--
-- PENDIENTE (fuera de alcance de esta migración, ver resumen del PR):
--   - UI de captura completa en el admin (formulario dedicado con máscara de
--     input). Este pase prioriza que el esquema + cifrado + RPC queden
--     correctos; el endpoint admin ya se conecta a las funciones RPC de
--     abajo (ver src/app/api/admin/empleados/[id]/route.ts).
--   - Rotación automática de PAYROLL_ENCRYPTION_KEY.
--   - Validación de checksum real del SIN (Luhn) -- hoy solo se valida
--     formato (9 dígitos), no dígito verificador.

-- ============================================================
-- 1. Columnas cifradas nuevas
-- ============================================================
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS sin_encrypted BYTEA,
  ADD COLUMN IF NOT EXISTS banking_details_encrypted BYTEA,
  ADD COLUMN IF NOT EXISTS banking_info_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS banking_info_updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN employees.sin_encrypted IS
  'v8.3 P0-8: SIN (Social Insurance Number) cifrado con pgp_sym_encrypt (pgcrypto). NUNCA se lee/escribe directo -- solo vía set_employee_banking_info()/get_employee_banking_info(). Requerido para T4/T4A ante CRA.';
COMMENT ON COLUMN employees.banking_details_encrypted IS
  'v8.3 P0-8: JSON {transit, institution, account} cifrado con pgp_sym_encrypt (pgcrypto). NUNCA se lee/escribe directo -- solo vía set_employee_banking_info()/get_employee_banking_info(). Usado para direct deposit de nómina.';
COMMENT ON COLUMN employees.banking_info_updated_at IS
  'v8.3 P0-8: última vez que set_employee_banking_info() escribió estas columnas (auditoría ligera -- el detalle fino vive en admin_action_logs vía requireAdminRole en el endpoint que llama al RPC).';
COMMENT ON COLUMN employees.banking_info_updated_by IS
  'v8.3 P0-8: auth.users.id del owner_admin que hizo el último set_employee_banking_info() sobre este empleado.';

-- ============================================================
-- 2. Bloqueo de acceso directo a las columnas cifradas desde clientes
--    normales (RLS es a nivel de FILA, no de columna -- esto es un REVOKE
--    a nivel de COLUMNA, más preciso: ni siquiera un empleado leyendo SU
--    PROPIA fila via "Employees read own profile" (003_modulo3_employee_
--    tables.sql) puede seleccionar estas dos columnas, ni siquiera el
--    ciphertext. Verificado contra el código real: ningún endpoint hace
--    `select("*")` sobre employees (grep confirmado) -- todos listan
--    columnas explícitas, así que este REVOKE no rompe ninguna consulta
--    existente. service_role sí puede (lo necesita src/lib/payroll-export.ts
--    a través de get_employee_banking_info(), que igual re-valida el rol
--    del llamador con has_admin_role() antes de descifrar nada).
-- ============================================================
REVOKE SELECT (sin_encrypted, banking_details_encrypted) ON employees FROM anon, authenticated;
GRANT SELECT (sin_encrypted, banking_details_encrypted) ON employees TO service_role;

-- ============================================================
-- 3. set_employee_banking_info() — único punto de escritura de SIN/banking.
--    SECURITY DEFINER: corre con los privilegios del dueño de la función
--    (puede escribir las columnas *_encrypted aunque el rol que llama no
--    tenga GRANT de columna), pero el PRIMER PASO adentro es exigir
--    has_admin_role(auth.uid(), ARRAY['owner_admin']) -- exactamente la
--    misma función helper que ya usan 040_e0_admin_rbac.sql y
--    203_e11_access_recovery_requests.sql, y el mismo rol que
--    admin-rbac.ts exige para los recursos 'payroll'/'employees_admin'
--    (MATRIX: payroll: ["owner_admin"], employees_admin: ["owner_admin"]) --
--    doble candado: la API ya llama requireAdminRole("employees_admin")
--    ANTES de invocar este RPC, y el RPC lo vuelve a exigir por su cuenta
--    para que la función nunca sea segura de llamar "porque ya se validó
--    arriba" -- se valida sola, sin confiar en el caller.
-- ============================================================
CREATE OR REPLACE FUNCTION set_employee_banking_info(
  p_employee_id UUID,
  p_sin TEXT,
  p_bank_transit_number TEXT,
  p_bank_institution_number TEXT,
  p_bank_account_number TEXT,
  p_encryption_key TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_updated BOOLEAN;
BEGIN
  IF NOT has_admin_role(auth.uid(), ARRAY['owner_admin']) THEN
    RAISE EXCEPTION 'set_employee_banking_info: solo owner_admin puede escribir SIN/datos bancarios' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_encryption_key IS NULL OR length(p_encryption_key) = 0 THEN
    RAISE EXCEPTION 'set_employee_banking_info: falta la clave de cifrado (PAYROLL_ENCRYPTION_KEY no configurada del lado servidor)';
  END IF;

  -- Validación de formato (defensa en profundidad -- la API/Zod del lado
  -- Next.js ya valida esto antes de llamar al RPC, pero la función nunca
  -- confía únicamente en el caller).
  IF p_sin !~ '^[0-9]{9}$' THEN
    RAISE EXCEPTION 'set_employee_banking_info: SIN inválido -- se esperan exactamente 9 dígitos';
  END IF;
  IF p_bank_transit_number !~ '^[0-9]{5}$' THEN
    RAISE EXCEPTION 'set_employee_banking_info: transit number inválido -- se esperan exactamente 5 dígitos';
  END IF;
  IF p_bank_institution_number !~ '^[0-9]{3}$' THEN
    RAISE EXCEPTION 'set_employee_banking_info: institution number inválido -- se esperan exactamente 3 dígitos';
  END IF;
  IF p_bank_account_number !~ '^[0-9]{7,12}$' THEN
    RAISE EXCEPTION 'set_employee_banking_info: account number inválido -- se esperan entre 7 y 12 dígitos';
  END IF;

  UPDATE employees
  SET
    sin_encrypted = pgp_sym_encrypt(p_sin, p_encryption_key),
    banking_details_encrypted = pgp_sym_encrypt(
      json_build_object(
        'transit', p_bank_transit_number,
        'institution', p_bank_institution_number,
        'account', p_bank_account_number
      )::text,
      p_encryption_key
    ),
    banking_info_updated_at = now(),
    banking_info_updated_by = auth.uid(),
    updated_at = now()
  WHERE id = p_employee_id
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'set_employee_banking_info: empleado % no encontrado (o eliminado)', p_employee_id;
  END IF;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION set_employee_banking_info(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_employee_banking_info(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;

COMMENT ON FUNCTION set_employee_banking_info IS
  'v8.3 P0-8: único punto de escritura de SIN/datos bancarios cifrados. SECURITY DEFINER + has_admin_role(owner_admin) interno. La clave de cifrado se recibe como parámetro (PAYROLL_ENCRYPTION_KEY del entorno de servidor), nunca vía GUC ni columna. Llamada desde src/app/api/admin/empleados/[id]/route.ts.';

-- ============================================================
-- 4. get_employee_banking_info() — único punto de lectura en texto plano.
--    Mismo candado doble que arriba (has_admin_role interno + requireAdminRole
--    en la API que la llama). Usada por el export de nómina
--    (src/lib/payroll-export.ts vía el endpoint payroll-export/route.ts) para
--    incluir el SIN descifrado SOLO cuando quien genera el export es
--    owner_admin -- nunca lee sin_encrypted/banking_details_encrypted
--    directo de la tabla.
-- ============================================================
CREATE OR REPLACE FUNCTION get_employee_banking_info(
  p_employee_id UUID,
  p_encryption_key TEXT
)
RETURNS TABLE (
  sin TEXT,
  bank_transit_number TEXT,
  bank_institution_number TEXT,
  bank_account_number TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_sin_encrypted BYTEA;
  v_banking_encrypted BYTEA;
  v_banking_json JSONB;
BEGIN
  IF NOT has_admin_role(auth.uid(), ARRAY['owner_admin']) THEN
    RAISE EXCEPTION 'get_employee_banking_info: solo owner_admin (flujo de nómina) puede leer SIN/datos bancarios' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_encryption_key IS NULL OR length(p_encryption_key) = 0 THEN
    RAISE EXCEPTION 'get_employee_banking_info: falta la clave de cifrado (PAYROLL_ENCRYPTION_KEY no configurada del lado servidor)';
  END IF;

  SELECT e.sin_encrypted, e.banking_details_encrypted
  INTO v_sin_encrypted, v_banking_encrypted
  FROM employees e
  WHERE e.id = p_employee_id
    AND e.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'get_employee_banking_info: empleado % no encontrado (o eliminado)', p_employee_id;
  END IF;

  IF v_sin_encrypted IS NULL AND v_banking_encrypted IS NULL THEN
    -- Empleado sin SIN/banking capturados todavía -- no es un error, el
    -- caller (export de nómina) debe manejar esto como "pendiente de
    -- completar onboarding bancario", no como fallo de cifrado.
    RETURN QUERY SELECT NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  IF v_banking_encrypted IS NOT NULL THEN
    v_banking_json := pgp_sym_decrypt(v_banking_encrypted, p_encryption_key)::jsonb;
  END IF;

  RETURN QUERY SELECT
    CASE WHEN v_sin_encrypted IS NOT NULL THEN pgp_sym_decrypt(v_sin_encrypted, p_encryption_key) ELSE NULL END,
    v_banking_json->>'transit',
    v_banking_json->>'institution',
    v_banking_json->>'account';
END;
$$;

REVOKE EXECUTE ON FUNCTION get_employee_banking_info(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_employee_banking_info(UUID, TEXT) TO authenticated, service_role;

COMMENT ON FUNCTION get_employee_banking_info IS
  'v8.3 P0-8: único punto de lectura en texto plano de SIN/datos bancarios. SECURITY DEFINER + has_admin_role(owner_admin) interno. Usada por el export de nómina (src/lib/payroll-export.ts). Nunca exponer su resultado a un rol distinto de owner_admin ni loguearlo en texto plano.';

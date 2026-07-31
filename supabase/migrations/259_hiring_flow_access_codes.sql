-- v0.4.1 (flujo de contratación) -- Fase 2 "Modelo de Datos Completo".
-- `access_codes` guarda los códigos de un solo uso (ej. enviados por
-- SMS/email, ver `communications` en 266) que un candidato usa para
-- avanzar de un paso a otro del flujo (step2, step3) sin tener una
-- cuenta con contraseña.
--
-- Por qué `code_hash` y NUNCA el código en texto plano: un access code es
-- equivalente en sensibilidad a una contraseña temporal -- cualquiera con
-- lectura de esta tabla (ej. un dump de backup, un acceso indebido a la
-- DB) NO debe poder suplantar a un candidato. Se guarda solo el hash
-- (ej. SHA-256/HMAC calculado en el servicio TS); la verificación
-- compara hash(código_recibido) == code_hash, nunca el valor crudo. El
-- código en texto plano existe solo efímeramente en el canal de envío
-- (SMS/email) y en memoria del request que lo generó -- nunca se
-- persiste.
--
-- Por qué `purpose` enumerado (step2/step3) y no una tabla genérica de
-- "tokens": cada purpose habilita una operación distinta del flujo y el
-- servicio TS necesita saber cuál es sin ambigüedad al validar; mismo
-- criterio que `status` en candidates (257).
--
-- Por qué ON DELETE CASCADE con candidates: un access_code no tiene
-- sentido ni valor de auditoría fuera del candidato al que pertenece (a
-- diferencia de electronic_signatures/consents, que si son registros de
-- auditoría independientes -- ver 262, 263).

CREATE TABLE IF NOT EXISTS access_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('step2', 'step3')),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_access_codes_candidate_purpose
  ON access_codes (candidate_id, purpose);

ALTER TABLE access_codes ENABLE ROW LEVEL SECURITY;

-- Service-role-only: la validación de un código la hace una ruta de API
-- (compara hash, chequea expires_at/used_at) con service role -- nunca
-- se expone esta tabla al cliente anon/authenticated.
DROP POLICY IF EXISTS "access_codes no direct access" ON access_codes;
CREATE POLICY "access_codes no direct access" ON access_codes
  FOR ALL USING (false) WITH CHECK (false);

COMMENT ON TABLE access_codes IS
  'v0.4.1 flujo de contratación: códigos de un solo uso para avanzar de '
  'paso sin cuenta. code_hash NUNCA es el código en texto plano -- solo '
  'su hash (equivalente a una contraseña temporal). Acceso exclusivo vía '
  'service role.';

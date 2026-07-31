-- v0.4.1 (flujo de contratación) -- Fase 5.3 "Paso 3: Información Fiscal y
-- Bancaria". `candidate_banking_info` guarda los datos de Direct Deposit
-- (transferencia electrónica de nómina) que un candidato aprobado entrega
-- para poder recibir su sueldo.
--
-- [WARNING] Esta tabla guarda transit_number/institution_number/
-- account_number en TEXTO PLANO, sin cifrado a nivel de columna. Es PII
-- financiera (permite iniciar una transferencia hacia esa cuenta). La
-- única protección implementada en esta fase es RLS 100% service-role-only
-- (idéntico al resto del PII del módulo, ver 257_hiring_flow_candidates.sql)
-- -- ningún cliente anon/authenticated puede leer ni escribir esta tabla
-- directamente. En una implementación de producción real conviene evaluar
-- cifrado a nivel de aplicación (ej. columnas cifradas con una KMS-managed
-- key) o, mejor aún, tokenización vía un proveedor de pagos/nómina (ej.
-- que el proveedor guarde los datos bancarios reales y este sistema solo
-- guarde un token de referencia), en vez de persistir transit/institution/
-- account crudos en esta base de datos. Se documenta esta limitación
-- explícitamente en vez de esconderla: para esta fase se prioriza tener el
-- flujo de Direct Deposit funcional end-to-end con el mismo nivel de
-- protección (RLS service-role-only) que ya usa el resto del PII de este
-- módulo, no shippear cifrado de columna a medias. No usar en producción
-- real sin revisar este punto primero.
--
-- Por qué UNIQUE (candidate_id) y por qué esta tabla es MUTABLE (a
-- diferencia de `consents` (263) y `electronic_signatures` (262), que son
-- históricos inmutables por diseño): un candidato solo tiene UNA cuenta
-- bancaria vigente para depósito a la vez. Si corrige un número de cuenta
-- mal tipeado o cambia de banco, eso es una corrección de información
-- operativa (dónde depositar), no un hecho legal versionado que deba
-- preservarse históricamente -- no tiene sentido acumular filas viejas de
-- "cuentas bancarias anteriores" de la misma forma que sí tiene sentido
-- preservar cada consentimiento o firma que un candidato dio en el
-- pasado. Por eso esta tabla soporta UPDATE (vía UPSERT con
-- onConflict: 'candidate_id' desde direct-deposit-service.ts) en vez de
-- solo INSERT+SELECT como 262/263.

CREATE TABLE IF NOT EXISTS candidate_banking_info (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  transit_number TEXT NOT NULL,
  institution_number TEXT NOT NULL,
  account_number TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT candidate_banking_info_candidate_id_unique UNIQUE (candidate_id)
);

CREATE INDEX IF NOT EXISTS idx_candidate_banking_info_candidate_id
  ON candidate_banking_info (candidate_id);

ALTER TABLE candidate_banking_info ENABLE ROW LEVEL SECURITY;

-- Service-role-only, sin ninguna policy permisiva -- mismo patrón que
-- candidates (257) y el resto del PII de este módulo. Ver [WARNING] en el
-- comentario de cabecera sobre las limitaciones de esta protección para
-- datos bancarios en texto plano.
DROP POLICY IF EXISTS "candidate_banking_info no direct access" ON candidate_banking_info;
CREATE POLICY "candidate_banking_info no direct access" ON candidate_banking_info
  FOR ALL USING (false) WITH CHECK (false);

COMMENT ON TABLE candidate_banking_info IS
  'v0.4.1 flujo de contratación: datos de Direct Deposit del candidato '
  '(transit/institution/account). [WARNING] texto plano, sin cifrado de '
  'columna -- ver comentario de cabecera de esta migración para el '
  'análisis de riesgo y la recomendación de cifrado/tokenización para '
  'producción real. UNIQUE(candidate_id): a diferencia de consents (263) '
  'y electronic_signatures (262), esta tabla es MUTABLE (UPSERT), no un '
  'histórico inmutable -- es información operativa que se corrige, no un '
  'hecho legal versionado. Acceso exclusivo vía service role.';

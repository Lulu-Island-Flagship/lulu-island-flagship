-- Fix (auditoría de integridad de datos 2026-08-02, continuación del ciclo
-- que produjo 305/307/312): PATCH /api/admin/contract-reviews/[id] con
-- action='sign' ejecutaba 4 pasos independientes desde el route.ts sin
-- ninguna transacción que los envolviera:
--   1. Marcar la contract_versions activa anterior como 'superseded'
--   2. Insertar la nueva contract_versions (status='active', firma clickwrap)
--   3. Reflejar los términos aprobados en service_contracts (frequency,
--      base_price, total, service_subtype)
--   4. Marcar la contract_reviews como 'signed'
--
-- Esto es un documento LEGAL (contrato de servicio firmado por el cliente,
-- vía clickwrap -- nombre + IP + timestamp). Si el paso 2 fallaba después de
-- que el paso 1 ya committeó (ej. timeout de red entre las dos llamadas REST
-- separadas), el contrato quedaba SIN ninguna versión 'active' -- ninguna
-- versión vigente firmada, un estado que no debería poder existir nunca. Si
-- el paso 3 o el 4 fallaban después de que el 1 y el 2 sí committearon, la
-- nueva versión firmada quedaba registrada en contract_versions pero
-- service_contracts seguía mostrando los términos VIEJOS (precio, frecuencia
-- desactualizados) y/o la revisión seguía en estado 'approved' en vez de
-- 'signed' -- permitiendo, entre otras cosas, que alguien intentara firmarla
-- de nuevo (doble versión 'active' simultánea para el mismo contrato,
-- violando el espíritu del historial versionado de la migración 168).
--
-- Fix: los 4 pasos -- los cuatro puramente de base de datos, no hay ninguna
-- llamada a un servicio externo en este flujo (a diferencia del RPC de
-- offboarding en 305, que sí tenía un paso 3 externo) -- se mueven a una
-- única función plpgsql (transacción atómica implícita: o los cuatro
-- committean juntos, o ninguno si algo lanza excepción). Se toma un lock de
-- fila (FOR UPDATE) sobre contract_reviews al leer, para que dos intentos de
-- 'sign' concurrentes sobre la misma revisión (doble clic, dos pestañas del
-- panel) se serialicen: el segundo, al adquirir el lock después de que el
-- primero ya committeó status='signed', encuentra status <> 'approved' y
-- aborta con REVIEW_NOT_APPROVED en vez de crear una segunda
-- contract_versions activa para el mismo contrato.

CREATE OR REPLACE FUNCTION sign_contract_review_atomic(
  p_review_id UUID,
  p_admin_id UUID,
  p_signed_by_name TEXT,
  p_signed_ip TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_review contract_reviews%ROWTYPE;
  v_current_version_number INT;
  v_next_version_number INT;
  v_terms JSONB;
  v_new_version contract_versions%ROWTYPE;
  v_updated_review contract_reviews%ROWTYPE;
BEGIN
  -- Fix (auditoría de seguridad, mismo patrón que 300/301/305): sin este
  -- chequeo, cualquier usuario autenticado podría invocar este RPC
  -- directamente y firmar cualquier contrato, saltándose
  -- requireAdminRole('compliance') del route.ts.
  -- auth.uid() lee el JWT de la sesión real (no current_user, que en
  -- SECURITY DEFINER devuelve el dueño de la función, no el caller).
  -- auth.uid() es NULL para llamadas service_role (sin sesión JWT).
  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM admin_roles WHERE user_id = auth.uid() AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'sign_contract_review_atomic: no autorizado -- se requiere un rol administrativo activo'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_signed_by_name IS NULL OR length(trim(p_signed_by_name)) = 0 THEN
    RAISE EXCEPTION 'SIGNED_BY_NAME_REQUIRED';
  END IF;

  -- Lock de la fila de la revisión: serializa intentos concurrentes de firma
  -- sobre la misma revisión (ver comentario de cabecera).
  SELECT * INTO v_review FROM contract_reviews WHERE id = p_review_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REVIEW_NOT_FOUND';
  END IF;
  IF v_review.status <> 'approved' THEN
    RAISE EXCEPTION 'REVIEW_NOT_APPROVED';
  END IF;

  -- --- 1. Supersede: la versión 'active' actual del contrato (si existe) ---
  SELECT version_number INTO v_current_version_number
  FROM contract_versions
  WHERE contract_id = v_review.contract_id AND status = 'active'
  ORDER BY version_number DESC
  LIMIT 1
  FOR UPDATE;

  v_next_version_number := COALESCE(v_current_version_number, 0) + 1;

  IF v_current_version_number IS NOT NULL THEN
    UPDATE contract_versions
    SET status = 'superseded'
    WHERE contract_id = v_review.contract_id AND status = 'active';
  END IF;

  -- --- 2. Insertar la nueva versión firmada (clickwrap) ---
  INSERT INTO contract_versions (
    contract_id, review_id, version_number, terms_snapshot, status,
    signed_by_name, signed_ip, signed_at
  )
  VALUES (
    v_review.contract_id, v_review.id, v_next_version_number, v_review.proposed_terms,
    'active', trim(p_signed_by_name), p_signed_ip, now()
  )
  RETURNING * INTO v_new_version;

  -- --- 3. Reflejar los términos aprobados en el contrato vigente ---
  -- Mismo criterio que el route.ts original: solo se tocan las columnas
  -- presentes en proposed_terms. Se usa COALESCE contra el valor actual de
  -- la columna (no NULL) para que una clave ausente en el JSON deje la
  -- columna sin cambios -- igual que en el TS original, donde una propiedad
  -- `undefined` del objeto simplemente se omitía del payload de .update() en
  -- vez de sobreescribir con NULL.
  v_terms := v_review.proposed_terms;
  IF v_terms IS NOT NULL THEN
    UPDATE service_contracts
    SET frequency = COALESCE(v_terms->>'frequency', frequency),
        base_price = COALESCE((v_terms->>'basePrice')::INTEGER, base_price),
        total = COALESCE((v_terms->>'total')::INTEGER, total),
        service_subtype = COALESCE(v_terms->>'serviceSubtype', service_subtype)
    WHERE id = v_review.contract_id;
  END IF;

  -- --- 4. Marcar la revisión como firmada ---
  UPDATE contract_reviews
  SET status = 'signed', reviewed_by = COALESCE(reviewed_by, p_admin_id)
  WHERE id = v_review.id
  RETURNING * INTO v_updated_review;

  RETURN jsonb_build_object(
    'review', to_jsonb(v_updated_review),
    'version', to_jsonb(v_new_version)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION sign_contract_review_atomic(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION sign_contract_review_atomic(UUID, UUID, TEXT, TEXT) TO authenticated, service_role;

COMMENT ON FUNCTION sign_contract_review_atomic IS
  'Fix integridad de datos 2026-08-02: agrupa atómicamente los 4 pasos de la firma de una contract_reviews (supersede de la versión anterior, inserción de la nueva contract_versions, reflejo de términos en service_contracts, y marcado de la revisión como signed), que antes eran 4 escrituras REST sueltas desde PATCH /api/admin/contract-reviews/[id] (action=sign). Toma FOR UPDATE sobre la fila de la revisión para serializar firmas concurrentes. Exige un admin_roles activo para llamadas no server-side.';

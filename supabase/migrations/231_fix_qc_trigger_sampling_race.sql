-- =============================================================================
-- Migración 231 — Fix A-6: el trigger de BD gana la carrera contra
-- POST /api/admin/qc y siempre escribe sampling_reason = 'Elite auto-approval',
-- por lo que el literal 'elite_auto_approval_sample' que busca
-- admin/qc/[orderId]/review/route.ts para activar la detección de
-- manipulación (src/lib/anti-gaming.ts) nunca llega a existir en producción.
--
-- Diagnóstico completo: docs/vigente/INFORME_LOGICA_NEGOCIO_ROLES_2026-07-21.md
-- §2 RAÍZ (Cadena 4), hallazgo A-6, §5.1.
--
-- trigger_create_qc_review_on_complete() se define originalmente en
-- 016_modulo7_qc_auto_trigger.sql y se re-crea en
-- 127_e0_fix_search_path_hijack_batch2.sql (versión vigente hasta ahora, que
-- es la que se reemplaza aquí). Corre AFTER UPDATE ON orders, en la MISMA
-- transacción que pone la orden en 'completed', y con ON CONFLICT (order_id)
-- DO NOTHING sobre qc_reviews (UNIQUE en 010_modulo7_qc_score_tables.sql:115)
-- siempre inserta primero -- la ruta POST /api/admin/qc, que sí conoce el
-- muestreo del 10%, nunca llega a ejecutar su INSERT.
--
-- FIX: se porta 1:1 (no es una aproximación) la lógica de
-- isQcSampleSelected() de src/lib/anti-gaming.ts DENTRO del trigger, para
-- que sea el propio trigger quien decida el muestreo en el momento de
-- insertar. El puerto es exacto porque:
--   - pgcrypto ya está habilitado en este proyecto (ver
--     204_e9_employee_sin_banking_encrypted.sql, vía seed.sql:
--     CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions), y
--     expone digest(text, 'sha256') -- no hace falta ninguna extensión nueva.
--   - isQcSampleSelected hace SHA-256("qc-sample::" || orderId || "::" ||
--     dateSalt) y toma los primeros 4 bytes como uint32 big-endian
--     (Buffer.readUInt32BE(0)), comparando h / 0xffffffff < rate (0.10).
--     Eso se replica byte a byte con get_byte() sobre el resultado de
--     extensions.digest(), sin RNG ni reloj de aplicación involucrados.
--   - El único insumo no trivial es dateSalt = getVancouverTodayString()
--     (src/lib/date-utils.ts), formato "YYYY-MM-DD" en America/Vancouver.
--     Se replica con to_char(NOW() AT TIME ZONE 'America/Vancouver',
--     'YYYY-MM-DD'). Como el trigger corre en la misma transacción que el
--     UPDATE que completa la orden (mismo instante real que hubiera usado
--     la ruta si hubiera llegado a ejecutarse), el salt coincide.
--
-- Con esto, el trigger inserta directamente:
--   - sampling_reason = 'Elite auto-approval'       (10% no muestreado, limpio)
--   - sampling_reason = 'elite_auto_approval_sample' (10% muestreado, requiere
--     revisión humana -- este es el literal que
--     admin/qc/[orderId]/review/route.ts:191 busca para evaluar
--     evaluateSampledRejectionRate()).
--
-- admin/qc/route.ts (POST) se actualiza en el mismo cambio (fuera de esta
-- migración, ver src/app/api/admin/qc/route.ts) para dejar de competir por
-- el INSERT y en su lugar confiar en el trigger + ON CONFLICT DO NOTHING.
-- =============================================================================

CREATE OR REPLACE FUNCTION trigger_create_qc_review_on_complete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_employee_id UUID;
  v_trust_level TEXT;
  v_auto_approval_revoked_at TIMESTAMPTZ;
  v_qc_status TEXT;
  v_sampling_reason TEXT;
  v_date_salt TEXT;
  v_hash_bytes BYTEA;
  v_hash_int BIGINT;
  v_sample_rate CONSTANT DOUBLE PRECISION := 0.1; -- QC_SAMPLING_RATE en anti-gaming.ts
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status <> 'completed') THEN
    SELECT employee_id INTO v_employee_id
    FROM assignments
    WHERE order_id = NEW.id
    ORDER BY assigned_at DESC
    LIMIT 1;

    IF v_employee_id IS NULL THEN
      RETURN NEW;
    END IF;

    -- v8.3 E5.2 -- igual que admin/qc/route.ts:80: auto_approval_revoked_at
    -- no-null fuerza muro QC completo (pending) sin importar trust_level.
    SELECT trust_level, auto_approval_revoked_at
    INTO v_trust_level, v_auto_approval_revoked_at
    FROM employees
    WHERE id = v_employee_id;

    IF v_trust_level = 'elite' AND v_auto_approval_revoked_at IS NULL THEN
      -- Puerto 1:1 de isQcSampleSelected(orderId, getVancouverTodayString())
      -- en src/lib/anti-gaming.ts.
      v_date_salt := to_char(NOW() AT TIME ZONE 'America/Vancouver', 'YYYY-MM-DD');
      v_hash_bytes := extensions.digest('qc-sample::' || NEW.id::text || '::' || v_date_salt, 'sha256');
      v_hash_int := (get_byte(v_hash_bytes, 0)::bigint << 24)
                  | (get_byte(v_hash_bytes, 1)::bigint << 16)
                  | (get_byte(v_hash_bytes, 2)::bigint << 8)
                  |  get_byte(v_hash_bytes, 3)::bigint;

      IF (v_hash_int::double precision / 4294967295.0) < v_sample_rate THEN
        -- Cayó en el 10% muestreado: habría sido auto-aprobado, pero pasa
        -- por revisión humana igual. Este es el literal que
        -- evaluateSampledRejectionRate() necesita ver aparecer.
        v_qc_status := 'pending';
        v_sampling_reason := 'elite_auto_approval_sample';
      ELSE
        v_qc_status := 'auto';
        v_sampling_reason := 'Elite auto-approval';
      END IF;
    ELSE
      v_qc_status := 'pending';
      v_sampling_reason := NULL;
    END IF;

    INSERT INTO qc_reviews (order_id, employee_id, status, sampling_reason)
    VALUES (NEW.id, v_employee_id, v_qc_status, v_sampling_reason)
    ON CONFLICT (order_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION trigger_create_qc_review_on_complete() IS
  'v8.3 fix (migración 231, auditoría 2026-07-21, A-6): muestreo del 10% '
  'anti-gaming (isQcSampleSelected, src/lib/anti-gaming.ts) portado 1:1 a '
  'SQL. Antes escribía siempre sampling_reason=''Elite auto-approval'' y '
  'ganaba la carrera contra POST /api/admin/qc, dejando '
  '''elite_auto_approval_sample'' inalcanzable en producción.';

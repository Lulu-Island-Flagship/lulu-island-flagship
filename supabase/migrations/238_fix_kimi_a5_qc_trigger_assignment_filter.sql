-- Fix Kimi-A5 (auditoría externa Kimi Code, 2026-07-21, verificado y
-- confirmado real -- cita exacta: 231_fix_qc_trigger_sampling_race.sql:70-74
-- y 016_modulo7_qc_auto_trigger.sql:19-23, el mismo bug heredado sin
-- corregir en ambas versiones del trigger).
--
-- trigger_create_qc_review_on_complete() elige el empleado a quien
-- atribuir la QC review con `ORDER BY assigned_at DESC LIMIT 1` sobre
-- `assignments`, SIN filtrar `deleted_at IS NULL` ni excluir
-- status='cancelled'. Si una asignación fue soft-deleted o cancelada (ej.
-- reasignación de última hora) pero técnicamente sigue siendo la fila más
-- reciente por assigned_at, el score/rework de la QC review se atribuye al
-- empleado equivocado.
--
-- Fix: mismo filtro que ya usa el resto del código para "asignación activa
-- real" (ver empleado/servicio/route.ts: `.is("deleted_at", null)` +
-- excluir cancelled) -- se aplica aquí también.
--
-- Fuera de alcance de este fix (limitación de diseño real, no un bug de
-- una línea): para servicios con equipo de 2+ personas, qc_reviews tiene
-- UNIQUE(order_id) -- solo puede existir UNA review por orden, así que
-- aun con el filtro correcto, un servicio en equipo sigue atribuyendo el
-- score/rework a UN SOLO empleado (el de asignación activa más reciente),
-- no a todo el equipo. Corregir eso requeriría cambiar el modelo de datos
-- (una qc_review por empleado-orden en vez de por orden) -- decisión de
-- producto, no una corrección de seguridad/lógica de una migración.
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
      AND deleted_at IS NULL
      AND status <> 'cancelled'
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
  'v8.3 fix (migración 231, A-6) + fix Kimi-A5 (migración 238, 2026-07-21): '
  'muestreo del 10% anti-gaming portado a SQL (231), y selección de '
  'empleado ahora filtra deleted_at/cancelled (238) -- no atribuye la QC '
  'review a una asignación borrada o cancelada. Limitación conocida sin '
  'resolver: servicios en equipo (2+ empleados) siguen atribuyendo la '
  'review a UN solo empleado por el UNIQUE(order_id) del esquema actual.';

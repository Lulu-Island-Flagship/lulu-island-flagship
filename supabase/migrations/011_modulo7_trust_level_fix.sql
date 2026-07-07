-- Migración: Agregar trust_level a tabla employees + fix recalculate_weekly_score

-- 1. Agregar trust_level a employees (campo persistente, no solo en employee_scores)
ALTER TABLE employees
ADD COLUMN IF NOT EXISTS trust_level TEXT NOT NULL DEFAULT 'standard'
  CHECK (trust_level IN ('elite', 'standard', 'observation', 'suspended'));

-- 2. Función RPC mejorada: recalculate_weekly_score con cálculo de sub-scores
-- Reemplaza la versión anterior que tenía problemas de JOIN complejo
CREATE OR REPLACE FUNCTION recalculate_weekly_score(p_employee_id UUID, p_week_start DATE)
RETURNS TABLE (total_score INTEGER, trust_level TEXT, telemetry_score INTEGER, audit_score INTEGER, peer_score INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_telemetry INTEGER := 0;
  v_audit INTEGER := 0;
  v_peer INTEGER := 0;
  v_total INTEGER := 0;
  v_trust TEXT := 'standard';
  v_services_count INTEGER := 0;
  v_disputes_count INTEGER := 0;
  v_qc_approved INTEGER := 0;
  v_upsells_count INTEGER := 0;
BEGIN
  -- Contar servicios de la semana
  SELECT COUNT(*) INTO v_services_count
  FROM assignments a
  JOIN orders o ON a.order_id = o.id
  WHERE a.employee_id = p_employee_id
    AND o.service_date >= p_week_start
    AND o.service_date < p_week_start + INTERVAL '7 days';

  -- Contar disputas resueltas de la semana
  SELECT COUNT(*) INTO v_disputes_count
  FROM tickets_disputas t
  JOIN orders o ON t.order_id = o.id
  WHERE t.employee_id = p_employee_id
    AND t.status = 'resolved'
    AND o.service_date >= p_week_start
    AND o.service_date < p_week_start + INTERVAL '7 days';

  -- Contar QC aprobados de la semana
  SELECT COUNT(*) INTO v_qc_approved
  FROM qc_reviews q
  JOIN orders o ON q.order_id = o.id
  WHERE q.employee_id = p_employee_id
    AND q.status = 'approved'
    AND o.service_date >= p_week_start
    AND o.service_date < p_week_start + INTERVAL '7 days';

  -- Contar upsells de la semana
  SELECT COUNT(*) INTO v_upsells_count
  FROM service_upsells u
  JOIN orders o ON u.order_id = o.id
  WHERE u.employee_id = p_employee_id
    AND o.service_date >= p_week_start
    AND o.service_date < p_week_start + INTERVAL '7 days';

  -- Telemetría (50%): base 50, penalizaciones y bonificaciones
  v_telemetry := 50
    - (v_disputes_count * 15)
    + (v_qc_approved * 5)
    + (v_upsells_count * 2);

  -- Si no hay servicios, telemetry = 0 (no puede haber score sin trabajo)
  IF v_services_count = 0 THEN
    v_telemetry := 0;
  END IF;

  v_telemetry := GREATEST(0, LEAST(50, v_telemetry));

  -- Auditoría (30%): promedio móvil últimas 5 evaluaciones (score 1-5 -> 0-30)
  SELECT COALESCE(AVG(score) * 6, 0) INTO v_audit
  FROM (
    SELECT score
    FROM field_audits
    WHERE employee_id = p_employee_id
    ORDER BY created_at DESC
    LIMIT 5
  ) recent;

  v_audit := GREATEST(0, LEAST(30, v_audit));

  -- Peer votes (20%): promedio de votaciones de la semana (rating 1-5 -> 0-20)
  SELECT COALESCE(AVG(rating) * 4, 0) INTO v_peer
  FROM peer_votes
  WHERE target_employee_id = p_employee_id
    AND week_start = p_week_start;

  v_peer := GREATEST(0, LEAST(20, v_peer));

  -- Total y nivel de confianza
  v_total := v_telemetry + v_audit + v_peer;

  v_trust := CASE
    WHEN v_total >= 90 THEN 'elite'
    WHEN v_total >= 70 THEN 'standard'
    WHEN v_total >= 50 THEN 'observation'
    ELSE 'suspended'
  END;

  RETURN QUERY SELECT v_total, v_trust, v_telemetry, v_audit, v_peer;
END;
$$;

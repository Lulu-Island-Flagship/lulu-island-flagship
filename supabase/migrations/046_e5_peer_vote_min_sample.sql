-- Migración 046 — v8.3 E5: anti-gaming basico en peer votes
-- Problema: recalculate_weekly_score() (migracion 011) promedia peer_votes sin
-- exigir una muestra minima de votantes distintos. Un solo companero (amigo u
-- hostil) puede decidir el 20% del score de otro empleado sin contrapeso.
-- Fix: si hay menos de 2 votantes DISTINTOS esa semana, el componente peer se
-- trata como NEUTRAL (10/20, el punto medio) en vez de confiar en un solo voto.
-- No descarta el voto (queda guardado para auditoria), solo no lo deja decidir
-- el score solo.

CREATE OR REPLACE FUNCTION recalculate_weekly_score(p_employee_id UUID, p_week_start DATE)
RETURNS TABLE (total_score INTEGER, trust_level TEXT, telemetry_score INTEGER, audit_score INTEGER, peer_score INTEGER, services_count INTEGER, disputes_count INTEGER)
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
  v_services_no_dispute INTEGER := 0;
  v_disputes_count INTEGER := 0;
  v_discrepancies_count INTEGER := 0;
  v_qc_approved INTEGER := 0;
  v_qc_rejected INTEGER := 0;
  v_upsells_count INTEGER := 0;
  v_punctuality_bonus INTEGER := 0;
  v_distinct_voters INTEGER := 0;
BEGIN
  SELECT COUNT(*) INTO v_services_count
  FROM assignments a
  JOIN orders o ON a.order_id = o.id
  WHERE a.employee_id = p_employee_id
    AND a.status = 'completed'
    AND o.service_date >= p_week_start
    AND o.service_date < p_week_start + INTERVAL '7 days';

  SELECT COUNT(*) INTO v_services_no_dispute
  FROM assignments a
  JOIN orders o ON a.order_id = o.id
  WHERE a.employee_id = p_employee_id
    AND a.status = 'completed'
    AND o.service_date >= p_week_start
    AND o.service_date < p_week_start + INTERVAL '7 days'
    AND NOT EXISTS (
      SELECT 1 FROM tickets_disputas t
      WHERE t.order_id = o.id AND t.employee_id = p_employee_id AND t.status = 'resolved'
    );

  SELECT COUNT(*) INTO v_disputes_count
  FROM tickets_disputas t
  JOIN orders o ON t.order_id = o.id
  WHERE t.employee_id = p_employee_id
    AND t.status = 'resolved'
    AND t.type = 'dispute'
    AND o.service_date >= p_week_start
    AND o.service_date < p_week_start + INTERVAL '7 days';

  SELECT COUNT(*) INTO v_discrepancies_count
  FROM tickets_disputas t
  JOIN orders o ON t.order_id = o.id
  WHERE t.employee_id = p_employee_id
    AND t.status = 'resolved'
    AND t.type = 'discrepancy'
    AND o.service_date >= p_week_start
    AND o.service_date < p_week_start + INTERVAL '7 days';

  SELECT COUNT(*) INTO v_qc_approved
  FROM qc_reviews q
  JOIN orders o ON q.order_id = o.id
  WHERE q.employee_id = p_employee_id
    AND q.status = 'approved'
    AND o.service_date >= p_week_start
    AND o.service_date < p_week_start + INTERVAL '7 days';

  SELECT COUNT(*) INTO v_qc_rejected
  FROM qc_reviews q
  JOIN orders o ON q.order_id = o.id
  WHERE q.employee_id = p_employee_id
    AND q.status = 'rejected'
    AND o.service_date >= p_week_start
    AND o.service_date < p_week_start + INTERVAL '7 days';

  SELECT COUNT(*) INTO v_upsells_count
  FROM service_upsells u
  JOIN orders o ON u.order_id = o.id
  WHERE u.employee_id = p_employee_id
    AND o.service_date >= p_week_start
    AND o.service_date < p_week_start + INTERVAL '7 days';

  WITH punctuality_data AS (
    SELECT
      o.id AS order_id,
      o.service_time,
      MIN(sl.timestamp) AS t_in
    FROM orders o
    JOIN assignments a ON a.order_id = o.id
    LEFT JOIN service_logs sl ON sl.order_id = o.id AND sl.event_type = 't_in'
    WHERE a.employee_id = p_employee_id
      AND a.status = 'completed'
      AND o.service_date >= p_week_start
      AND o.service_date < p_week_start + INTERVAL '7 days'
    GROUP BY o.id, o.service_time
  )
  SELECT COALESCE(
    SUM(CASE
      WHEN t_in IS NULL THEN 0
      WHEN ABS(EXTRACT(EPOCH FROM (t_in::time - service_time::time))) <= 900 THEN 10
      WHEN ABS(EXTRACT(EPOCH FROM (t_in::time - service_time::time))) <= 1800 THEN 5
      ELSE -10
    END), 0
  ) INTO v_punctuality_bonus
  FROM punctuality_data;

  v_punctuality_bonus := GREATEST(-20, LEAST(20, v_punctuality_bonus));

  v_telemetry := 50
    + (v_services_no_dispute * 5)
    - (v_disputes_count * 15)
    - (v_discrepancies_count * 10)
    + (v_qc_approved * 5)
    + (v_upsells_count * 2)
    - (v_qc_rejected * 10)
    + v_punctuality_bonus;

  IF v_services_count = 0 THEN
    v_telemetry := 0;
  END IF;

  v_telemetry := GREATEST(0, LEAST(50, v_telemetry));

  SELECT COALESCE(AVG(score) * 6, 0) INTO v_audit
  FROM (
    SELECT score
    FROM field_audits
    WHERE employee_id = p_employee_id
    ORDER BY created_at DESC
    LIMIT 5
  ) recent;

  v_audit := GREATEST(0, LEAST(30, v_audit));

  -- v8.3 E5 anti-gaming: contar votantes DISTINTOS esta semana antes de confiar
  -- en el promedio. Un solo voto (amigo u hostil) no debe decidir el 20% del score.
  SELECT COUNT(DISTINCT voter_employee_id) INTO v_distinct_voters
  FROM peer_votes
  WHERE target_employee_id = p_employee_id
    AND week_start = p_week_start;

  IF v_distinct_voters >= 2 THEN
    SELECT COALESCE(AVG(rating) * 4, 0) INTO v_peer
    FROM peer_votes
    WHERE target_employee_id = p_employee_id
      AND week_start = p_week_start;
  ELSE
    -- Muestra insuficiente (0 o 1 votante): neutral, ni castiga ni premia.
    v_peer := 10;
  END IF;

  v_peer := GREATEST(0, LEAST(20, v_peer));

  v_total := v_telemetry + v_audit + v_peer;

  v_trust := CASE
    WHEN v_total >= 90 THEN 'elite'
    WHEN v_total >= 70 THEN 'standard'
    WHEN v_total >= 50 THEN 'observation'
    ELSE 'suspended'
  END;

  RETURN QUERY SELECT v_total, v_trust, v_telemetry, v_audit, v_peer, v_services_count, v_disputes_count;
END;
$$;

-- Migración: Agregar trust_level a tabla employees + fix recalculate_weekly_score con fórmula completa de telemetry

-- 1. Agregar trust_level a employees (campo persistente, no solo en employee_scores)
ALTER TABLE employees
ADD COLUMN IF NOT EXISTS trust_level TEXT NOT NULL DEFAULT 'standard'
  CHECK (trust_level IN ('elite', 'standard', 'observation', 'suspended'));

-- 2. Función RPC mejorada: recalculate_weekly_score con fórmula completa de telemetry
-- Reemplaza la versión anterior. Fórmula telemetry (0-50):
--   Base: 50
--   +5 por cada servicio completado SIN disputa
--   -15 por cada disputa resuelta
--   -10 por cada discrepancia reportada
--   +5 por cada QC aprobado
--   +2 por cada upsell registrado
--   ±5-10 puntualidad (comparando T_in real vs service_time estimado)
--   -10 por cada foto rechazada en QC
--   Clamp [0, 50]
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
  v_services_no_dispute INTEGER := 0;
  v_disputes_count INTEGER := 0;
  v_discrepancies_count INTEGER := 0;
  v_qc_approved INTEGER := 0;
  v_qc_rejected INTEGER := 0;
  v_upsells_count INTEGER := 0;
  v_punctuality_bonus INTEGER := 0;
BEGIN
  -- Contar servicios completados de la semana
  SELECT COUNT(*) INTO v_services_count
  FROM assignments a
  JOIN orders o ON a.order_id = o.id
  WHERE a.employee_id = p_employee_id
    AND a.status = 'completed'
    AND o.service_date >= p_week_start
    AND o.service_date < p_week_start + INTERVAL '7 days';

  -- Contar servicios completados SIN disputa (para +5 cada uno)
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

  -- Contar disputas resueltas de la semana
  SELECT COUNT(*) INTO v_disputes_count
  FROM tickets_disputas t
  JOIN orders o ON t.order_id = o.id
  WHERE t.employee_id = p_employee_id
    AND t.status = 'resolved'
    AND t.type = 'dispute'
    AND o.service_date >= p_week_start
    AND o.service_date < p_week_start + INTERVAL '7 days';

  -- Contar discrepancias reportadas de la semana
  SELECT COUNT(*) INTO v_discrepancies_count
  FROM tickets_disputas t
  JOIN orders o ON t.order_id = o.id
  WHERE t.employee_id = p_employee_id
    AND t.status = 'resolved'
    AND t.type = 'discrepancy'
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

  -- Contar QC rechazados de la semana (fotos rechazadas = -10 cada uno)
  SELECT COUNT(*) INTO v_qc_rejected
  FROM qc_reviews q
  JOIN orders o ON q.order_id = o.id
  WHERE q.employee_id = p_employee_id
    AND q.status = 'rejected'
    AND o.service_date >= p_week_start
    AND o.service_date < p_week_start + INTERVAL '7 days';

  -- Contar upsells de la semana
  SELECT COUNT(*) INTO v_upsells_count
  FROM service_upsells u
  JOIN orders o ON u.order_id = o.id
  WHERE u.employee_id = p_employee_id
    AND o.service_date >= p_week_start
    AND o.service_date < p_week_start + INTERVAL '7 days';

  -- Calcular puntualidad: comparar T_in (primer service_logs t_in) vs service_time
  -- Usar timestamp completo para evitar problemas con servicios que cruzan medianoche
  -- Diferencia <= 15 min = +10 puntos
  -- Diferencia <= 30 min = +5 puntos
  -- Diferencia > 30 min = -10 puntos
  -- No hay T_in registrado = 0 puntos de puntualidad (no penaliza ni bonifica)
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

  -- Acotar puntualidad a un rango razonable para no desbalancear telemetry
  -- Máximo ±20 puntos (equivalente a ~4 servicios perfectos o 2 muy tarde)
  v_punctuality_bonus := GREATEST(-20, LEAST(20, v_punctuality_bonus));

  -- Telemetría (50%): base 50 + bonificaciones - penalizaciones
  v_telemetry := 50
    + (v_services_no_dispute * 5)
    - (v_disputes_count * 15)
    - (v_discrepancies_count * 10)
    + (v_qc_approved * 5)
    + (v_upsells_count * 2)
    - (v_qc_rejected * 10)
    + v_punctuality_bonus;

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

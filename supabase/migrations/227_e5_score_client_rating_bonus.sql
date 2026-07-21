-- Migración 192 — v8.3 E5 (auditoría 2026-07-18): componente de rating del
-- cliente en el score compuesto.
--
-- Bug real: recalculate_weekly_score() (migración 011, luego reemplazada
-- por 046 para el anti-gaming de peer_votes) nunca leía client_reviews.rating
-- -- el score compuesto (telemetry + audit + peer) no reflejaba en absoluto
-- lo que el cliente calificó después del servicio (Fase 8.1,
-- migración 010: client_reviews). Se agrega un bonus/penalización DENTRO de
-- los clamps existentes del total (v_total sigue acotado a [0, 100] al
-- final, igual que antes):
--   Promedio de client_reviews.rating de las reseñas de esta semana
--   (asociadas a órdenes que el empleado completó esa semana):
--     avg >= 4.8  -> +10
--     avg <  4.0  -> -10
--     en cualquier otro caso (o sin reseñas)  -> 0 (neutral, no castiga ni
--       premia por falta de dato -- igual criterio que peer_score con
--       muestra insuficiente, migración 046)
--
-- Se replica el cuerpo completo de la versión vigente (046, que ya incluye
-- el fix de muestra mínima de peer_votes) y se le agrega SOLO el componente
-- de rating de cliente, para no perder ningún fix anterior.

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
  v_avg_client_rating NUMERIC;
  v_client_rating_bonus INTEGER := 0;
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

  -- v8.3 E5 (migración 192): componente de rating del cliente. Promedio de
  -- client_reviews.rating de las reseñas dejadas esta semana para órdenes
  -- que este empleado completó (join por assignments, igual patrón que el
  -- resto de la función). Sin reseñas esta semana -> bonus 0 (neutral, no
  -- hay dato con que castigar ni premiar).
  SELECT AVG(cr.rating) INTO v_avg_client_rating
  FROM client_reviews cr
  JOIN orders o ON cr.order_id = o.id
  JOIN assignments a ON a.order_id = o.id AND a.employee_id = p_employee_id
  WHERE o.service_date >= p_week_start
    AND o.service_date < p_week_start + INTERVAL '7 days';

  IF v_avg_client_rating IS NOT NULL THEN
    IF v_avg_client_rating >= 4.8 THEN
      v_client_rating_bonus := 10;
    ELSIF v_avg_client_rating < 4.0 THEN
      v_client_rating_bonus := -10;
    ELSE
      v_client_rating_bonus := 0;
    END IF;
  END IF;

  -- Total y nivel de confianza. El bonus/penalización de rating de cliente
  -- se aplica DENTRO del clamp final existente (0-100), tal como pide la
  -- auditoría -- no se le da su propio clamp independiente porque no es un
  -- componente de peso fijo como telemetry/audit/peer, es un ajuste sobre
  -- el total ya compuesto.
  v_total := v_telemetry + v_audit + v_peer + v_client_rating_bonus;
  v_total := GREATEST(0, LEAST(100, v_total));

  v_trust := CASE
    WHEN v_total >= 90 THEN 'elite'
    WHEN v_total >= 70 THEN 'standard'
    WHEN v_total >= 50 THEN 'observation'
    ELSE 'suspended'
  END;

  RETURN QUERY SELECT v_total, v_trust, v_telemetry, v_audit, v_peer, v_services_count, v_disputes_count;
END;
$$;

COMMENT ON FUNCTION recalculate_weekly_score(UUID, DATE) IS
  'v8.3 E5 migración 192: agrega el componente de rating de cliente (client_reviews.rating, +10 si avg semanal >=4.8, -10 si <4.0, dentro del clamp final 0-100) al score compuesto que ya traía anti-gaming de peer_votes (migración 046). Toda migración futura que toque esta función debe partir de este cuerpo completo, no de 011 ni 046 directamente (mismo error que ya documentó la migración 176 para tickets_disputas.type).';

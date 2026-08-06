-- Auditoría 2026-08-05, item 2.4: endpoint público /api/client/review
-- usaba service role para writes. Se reemplaza con una RPC SECURITY DEFINER
-- que encapsula las 3 operaciones de escritura con privilegio mínimo.
-- El endpoint ahora solo valida con cliente anónimo y llama esta función.

CREATE OR REPLACE FUNCTION submit_client_review(
  p_order_id UUID,
  p_user_id UUID,
  p_rating INTEGER,
  p_comment TEXT,
  p_sentiment_score DOUBLE PRECISION,
  p_deadline_iso TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_review_id UUID;
  v_review JSONB;
BEGIN
  -- 1. Insertar la review
  INSERT INTO client_reviews (
    order_id, user_id, rating, comment, sentiment_score, review_window_expires_at
  ) VALUES (
    p_order_id, p_user_id, p_rating, p_comment, p_sentiment_score, p_deadline_iso
  )
  RETURNING id, order_id, user_id, rating, comment, sentiment_score,
    review_window_expires_at, created_at
  INTO STRICT v_review_id, v_review;

  -- 2. Si sentimiento es muy negativo, crear alerta
  IF p_sentiment_score < -0.5 THEN
    INSERT INTO sentiment_alerts (client_review_id, sentiment_score, status)
    VALUES (v_review_id, p_sentiment_score, 'pending');
  END IF;

  -- 3. Marcar token como usado
  UPDATE orders
  SET review_token_used_at = now()
  WHERE id = p_order_id;

  -- Devolver la review creada
  RETURN jsonb_build_object(
    'id', v_review_id,
    'order_id', p_order_id,
    'user_id', p_user_id,
    'rating', p_rating,
    'comment', p_comment,
    'sentiment_score', p_sentiment_score,
    'review_window_expires_at', p_deadline_iso,
    'created_at', now()
  );
END;
$$;

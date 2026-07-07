-- Tabla de rate limiting por IP para cotizaciones
-- Reemplaza el Map en memoria que no funciona en Vercel serverless

CREATE TABLE IF NOT EXISTS rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1,
  window_start TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  window_end TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(ip_address, window_start)
);

-- Índice para búsqueda rápida por IP
CREATE INDEX IF NOT EXISTS idx_rate_limits_ip ON rate_limits(ip_address);

-- Índice para limpiar ventanas expiradas
CREATE INDEX IF NOT EXISTS idx_rate_limits_window_end ON rate_limits(window_end);

-- Política RLS: solo el servidor puede leer/escribir (no clientes directos)
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No direct client access" ON rate_limits
  FOR ALL USING (false) WITH CHECK (false);

-- Función RPC para verificar y actualizar rate limit de forma atómica
-- Lógica: ventana deslizante de 24h por IP desde el primer request
-- Atómica via INSERT ... ON CONFLICT (no SELECT-then-INSERT)
CREATE OR REPLACE FUNCTION check_rate_limit(p_ip_address TEXT, p_max_requests INTEGER DEFAULT 3)
RETURNS TABLE(allowed BOOLEAN, remaining INTEGER, reset_at TIMESTAMP WITH TIME ZONE) AS $$
DECLARE
  v_window_start TIMESTAMP WITH TIME ZONE;
  v_window_end TIMESTAMP WITH TIME ZONE;
  v_count INTEGER;
BEGIN
  -- Buscar la fila más reciente para esta IP
  SELECT window_start, window_end, request_count
  INTO v_window_start, v_window_end, v_count
  FROM rate_limits
  WHERE ip_address = p_ip_address
  ORDER BY window_start DESC
  LIMIT 1;

  -- Si no existe fila, o la ventana más reciente ya expiró: crear NUEVA ventana
  IF v_window_start IS NULL OR NOW() > v_window_end THEN
    v_window_start := NOW();
    v_window_end := NOW() + INTERVAL '24 hours';

    -- INSERT atómico con ON CONFLICT (maneja race condition si otra request insertó)
    INSERT INTO rate_limits (ip_address, request_count, window_start, window_end)
    VALUES (p_ip_address, 1, v_window_start, v_window_end)
    ON CONFLICT (ip_address, window_start) DO UPDATE
      SET request_count = rate_limits.request_count + 1,
          updated_at = NOW()
    RETURNING request_count INTO v_count;

    -- Si el INSERT ON CONFLICT incrementó a 1, era nueva ventana -> permitir
    -- Si incrementó a >1, otra request ganó la carrera -> recalcular remaining
    IF v_count <= p_max_requests THEN
      RETURN QUERY SELECT TRUE, p_max_requests - v_count, v_window_end;
    ELSE
      RETURN QUERY SELECT FALSE, 0, v_window_end;
    END IF;

    RETURN;
  END IF;

  -- Ventana vigente existe: intentar incrementar atómicamente
  INSERT INTO rate_limits (ip_address, request_count, window_start, window_end)
  VALUES (p_ip_address, 1, v_window_start, v_window_end)
  ON CONFLICT (ip_address, window_start) DO UPDATE
    SET request_count = rate_limits.request_count + 1,
        updated_at = NOW()
  RETURNING request_count INTO v_count;

  IF v_count > p_max_requests THEN
    RETURN QUERY SELECT FALSE, 0, v_window_end;
  ELSE
    RETURN QUERY SELECT TRUE, p_max_requests - v_count, v_window_end;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Función para limpiar entradas expiradas (llamar desde cron o manualmente)
CREATE OR REPLACE FUNCTION cleanup_expired_rate_limits()
RETURNS INTEGER AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM rate_limits WHERE window_end < NOW();
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

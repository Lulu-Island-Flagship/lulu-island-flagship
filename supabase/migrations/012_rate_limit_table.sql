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
CREATE OR REPLACE FUNCTION check_rate_limit(p_ip_address TEXT, p_max_requests INTEGER DEFAULT 3)
RETURNS TABLE(allowed BOOLEAN, remaining INTEGER, reset_at TIMESTAMP WITH TIME ZONE) AS $$
DECLARE
  v_window_start TIMESTAMP WITH TIME ZONE;
  v_window_end TIMESTAMP WITH TIME ZONE;
  v_count INTEGER;
  v_existing_id UUID;
BEGIN
  v_window_start := DATE_TRUNC('hour', NOW()); -- Ventana de 24h desde el primer request
  v_window_end := v_window_start + INTERVAL '24 hours';

  -- Buscar entrada existente para esta IP en la ventana actual
  SELECT id, request_count INTO v_existing_id, v_count
  FROM rate_limits
  WHERE ip_address = p_ip_address
    AND window_start = v_window_start;

  IF v_existing_id IS NULL THEN
    -- Primera request de esta IP en esta ventana
    INSERT INTO rate_limits (ip_address, request_count, window_start, window_end)
    VALUES (p_ip_address, 1, v_window_start, v_window_end);
    
    RETURN QUERY SELECT TRUE, p_max_requests - 1, v_window_end;
  ELSIF v_count >= p_max_requests THEN
    -- Límite alcanzado
    RETURN QUERY SELECT FALSE, 0, v_window_end;
  ELSE
    -- Incrementar contador
    UPDATE rate_limits
    SET request_count = request_count + 1,
        updated_at = NOW()
    WHERE id = v_existing_id;
    
    RETURN QUERY SELECT TRUE, p_max_requests - (v_count + 1), v_window_end;
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

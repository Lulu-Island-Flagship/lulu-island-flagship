-- Migración: Módulo 8 — Token cifrado para evaluaciones post-servicio
-- Agrega review_token a orders para URLs firmadas de reseña

-- 1. Agregar columna review_token a orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS review_token UUID UNIQUE;

-- 2. Agregar columna review_token_used_at para trackear uso sin destruir el token
ALTER TABLE orders ADD COLUMN IF NOT EXISTS review_token_used_at TIMESTAMPTZ;

-- 3. Índice para búsqueda rápida por token
CREATE INDEX IF NOT EXISTS idx_orders_review_token ON orders(review_token);

-- 4. Generar tokens para órdenes existentes que no tengan uno
UPDATE orders SET review_token = gen_random_uuid() WHERE review_token IS NULL;

-- 5. Función para generar token de reseña al completar una orden
CREATE OR REPLACE FUNCTION generate_review_token(p_order_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_token UUID;
BEGIN
  v_token := gen_random_uuid();
  
  UPDATE orders 
  SET review_token = v_token,
      review_token_used_at = NULL
  WHERE id = p_order_id
    AND status = 'completed'
    AND review_token IS NULL;
  
  RETURN v_token;
END;
$$;

-- 6. Trigger: generar token automáticamente cuando una orden se marca como completada
CREATE OR REPLACE FUNCTION trigger_generate_review_token_on_complete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status <> 'completed') THEN
    NEW.review_token := gen_random_uuid();
    NEW.review_token_used_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS generate_review_token_trigger ON orders;
CREATE TRIGGER generate_review_token_trigger
  BEFORE UPDATE ON orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION trigger_generate_review_token_on_complete();

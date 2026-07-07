-- Migración: Módulo 8 — Token cifrado para evaluaciones post-servicio
-- Agrega review_token a orders para URLs firmadas de reseña

-- 1. Agregar columna review_token a orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS review_token UUID UNIQUE;

-- 2. Índice para búsqueda rápida por token
CREATE INDEX IF NOT EXISTS idx_orders_review_token ON orders(review_token);

-- 3. Generar tokens para órdenes existentes que no tengan uno
UPDATE orders SET review_token = gen_random_uuid() WHERE review_token IS NULL;

-- 4. Función para generar token de reseña al completar una orden
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
  SET review_token = v_token
  WHERE id = p_order_id
    AND status = 'completed'
    AND review_token IS NULL;
  
  RETURN v_token;
END;
$$;

-- Fix (auditoría CI/build/config 2026-08-01): orders.user_id se usa en las
-- políticas RLS "Clients read own orders" (SELECT USING auth.uid() = user_id,
-- migraciones 001/008) y "Users insert/update own orders" (migración 019),
-- pero nunca se creó un índice sobre esa columna -- a diferencia de
-- quotes.user_id, que sí lo tiene desde 001 (idx_quotes_user_id). Sin
-- índice, cada evaluación de esas políticas (y cualquier query de un cliente
-- filtrando sus propias órdenes) hace un seq scan completo de la tabla.
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);

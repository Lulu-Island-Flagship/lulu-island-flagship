-- Migración: Políticas RLS para supervisores en orders y quotes (Módulo 5 — Panel Admin)
-- Ejecutar en SQL Editor de Supabase

-- ============================================================
-- 1. Activar RLS en orders (si no está activo)
-- ============================================================
ALTER TABLE IF EXISTS orders ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. Políticas para orders
-- ============================================================
-- Clientes pueden leer sus propias órdenes
DROP POLICY IF EXISTS "Clients read own orders" ON orders;
CREATE POLICY "Clients read own orders" ON orders
  FOR SELECT USING (auth.uid() = user_id);

-- Supervisores pueden leer todas las órdenes
DROP POLICY IF EXISTS "Supervisors read all orders" ON orders;
CREATE POLICY "Supervisors read all orders" ON orders
  FOR SELECT USING (is_supervisor(auth.uid()));

-- ============================================================
-- 3. Activar RLS en quotes (si no está activo)
-- ============================================================
ALTER TABLE IF EXISTS quotes ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 4. Políticas para quotes
-- ============================================================
-- Clientes pueden leer sus propias cotizaciones
DROP POLICY IF EXISTS "Clients read own quotes" ON quotes;
CREATE POLICY "Clients read own quotes" ON quotes
  FOR SELECT USING (auth.uid() = user_id);

-- Supervisores pueden leer todas las cotizaciones
DROP POLICY IF EXISTS "Supervisors read all quotes" ON quotes;
CREATE POLICY "Supervisors read all quotes" ON quotes
  FOR SELECT USING (is_supervisor(auth.uid()));

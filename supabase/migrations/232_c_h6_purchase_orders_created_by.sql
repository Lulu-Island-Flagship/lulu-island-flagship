-- v8.3 auditoría 2026-07-21 (C-H6): purchase_orders no tenía columna
-- created_by, así que no había forma de detectar después que la misma
-- persona creó y aprobó una orden de compra (POST /admin/purchase-orders y
-- las acciones de /admin/purchase-orders/[id]/approve comparten el mismo
-- recurso RBAC "inventory" -- ver informe INFORME_LOGICA_NEGOCIO_ROLES_2026-07-21.md
-- §3.3 C-H6).
--
-- Referencia a auth.users(id), no a employees(id): requireAdminRole()
-- (src/lib/admin.ts:89-164) resuelve el usuario autenticado vía
-- supabase.auth.getUser(), y auth.user.id es un id de auth.users. Es el
-- mismo patrón que admin_roles.user_id (040_e0_admin_rbac.sql:10-11) y que
-- la mayoría de columnas created_by del repo (023, 001, 134, 166, 139, 224,
-- 028, 034, 177). purchase_orders.approved_by en cambio referencia
-- employees(id) (048:109) -- se deja tal cual, es una columna existente y
-- fuera del alcance de este fix; created_by usa auth.users(id) para poder
-- comparar directo contra auth.user.id sin un JOIN adicional a employees.
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id);

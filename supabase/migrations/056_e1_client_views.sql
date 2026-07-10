-- ============================================================
-- E1 — Blindaje de privacidad a nivel de base de datos (invariante B.2.3)
-- Hoy la privacidad de client_score, estimated_labor_cost,
-- estimated_margin_contribution, admin_review_reason/notes/approvers,
-- consent_ip, etc. se protege SOLO en la capa de aplicación
-- (src/lib/client-visible-columns.ts hace un SELECT explícito). Eso es
-- frágil: cualquier código nuevo (o una consulta hecha a mano desde
-- devtools contra la API de Supabase con la sesión del propio cliente)
-- podría pedir select("*") y filtrar esos datos, porque RLS solo protege
-- FILAS, no columnas.
--
-- Esta migración agrega una segunda capa, a nivel de Postgres:
-- vistas que exponen ÚNICAMENTE las columnas listadas en
-- src/lib/client-visible-columns.ts (única fuente de verdad — si esa
-- lista cambia, esta vista debe actualizarse en la misma migración).
--
-- security_invoker = true es la parte crítica: sin esto, una vista
-- corre con los privilegios del DUEÑO de la vista (normalmente el rol
-- que corre las migraciones) y IGNORARÍA las políticas RLS de la tabla
-- base para cualquiera que la consulte — el peor escenario posible.
-- Con security_invoker=true, la vista se ejecuta con los privilegios
-- de quien la consulta, así que las políticas RLS de `quotes`/`orders`
-- (auth.uid() = user_id, etc.) se siguen aplicando normalmente.
--
-- NOTA (alcance de esta sesión): se agregan las vistas y se apuntan las
-- rutas de cliente a ellas. NO se revocan columnas por GRANT en las
-- tablas base `quotes`/`orders` para el rol `authenticated`, porque ese
-- rol es el MISMO que usan las rutas admin (la distinción admin/cliente
-- hoy es solo de aplicación vía admin_roles + RLS, no un rol de Postgres
-- separado) — revocar columnas ahí rompería paneles admin que sí
-- necesitan client_score/admin_review_reason/etc. Esa es una decisión de
-- arquitectura (¿separar el rol de Postgres para sesiones admin?) que
-- REPORTE_E1.md ya señaló como pendiente de sesión supervisada con pagos
-- en vivo. Esta migración cierra la fuga real (una consulta select("*")
-- desde una página de cliente ya no puede traer más que estas columnas,
-- sin importar qué tan mal escrita esté esa consulta futura).
-- ============================================================

CREATE OR REPLACE VIEW quotes_client_view
WITH (security_invoker = true) AS
SELECT
  id,
  user_id,
  service_category,
  service_subtype,
  service_type,
  bedrooms,
  bathrooms,
  square_feet,
  pets_count,
  pets_type,
  residents,
  days_since_cleaning,
  address,
  zone,
  postal_code,
  day_of_week,
  is_preferred_day,
  base_price,
  organic_multiplier,
  organic_adjustment,
  recency_multiplier,
  recency_adjustment,
  zone_surcharge,
  logistics_surcharge,
  rule_adjustment,
  applied_rules,
  subtotal,
  gst,
  pst,
  total,
  hold_amount,
  price_frozen_until,
  status,
  admin_review_required, -- solo el booleano — el motivo (admin_review_reason) NO se expone
  consent_tc,
  consent_pipa,
  consent_marketing,
  consent_photo_marketing,
  purchase_order,
  created_at
FROM quotes;

COMMENT ON VIEW quotes_client_view IS
  'v8.3 E1: proyección de solo lectura de quotes para contexto CLIENTE. '
  'Excluye a propósito client_score, estimated_labor_cost, '
  'estimated_margin_contribution, admin_review_reason/notas/aprobadores, '
  'consent_ip, pipa_alt_requires_audit. Debe reflejar src/lib/client-visible-columns.ts.';

CREATE OR REPLACE VIEW orders_client_view
WITH (security_invoker = true) AS
SELECT
  id,
  quote_id,
  user_id,
  service_date,
  service_time,
  service_datetime,
  status,
  payment_option,
  hold_amount,
  cancellation_window_hours,
  wallet_amount_used,
  total_paid,
  warranty_status,
  created_at
FROM orders;

COMMENT ON VIEW orders_client_view IS
  'v8.3 E1: proyección de solo lectura de orders para contexto CLIENTE. '
  'Excluye a propósito admin_review_*, stripe_* (ids técnicos), *_attempts, '
  '*_last_error, paypal_refund_*, qbo_export_status. '
  'Debe reflejar src/lib/client-visible-columns.ts.';

-- Las vistas son objetos nuevos: hay que otorgar SELECT explícitamente.
-- RLS de las tablas base sigue aplicando gracias a security_invoker=true,
-- así que esto NO amplía acceso — solo permite consultar la vista misma.
GRANT SELECT ON quotes_client_view TO authenticated, anon;
GRANT SELECT ON orders_client_view TO authenticated, anon;

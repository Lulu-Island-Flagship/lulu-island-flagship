/**
 * v8.3 E1 — Columnas visibles para el CLIENTE (invariante B.2.3:
 * el cliente nunca ve su score interno, N, HHE ni la economía interna).
 *
 * Toda lectura de quotes/orders en contexto de usuario (páginas del cliente,
 * APIs públicas) DEBE usar estas listas — nunca select("*").
 *
 * Columnas EXCLUIDAS a propósito:
 *   quotes: client_score, estimated_labor_cost, estimated_margin_contribution,
 *           admin_review_reason/notas/aprobadores, consent_ip, pipa_alt_requires_audit,
 *           client_property_id, requires_field_auditor, property_risk_tier (B.2.3:
 *           el cliente nunca ve el score de riesgo de su dirección)
 *   orders: admin_review_*, stripe_* (ids técnicos), *_attempts, *_last_error,
 *           paypal_refund_*, qbo_export_status, client_property_id,
 *           requires_field_auditor, property_risk_tier
 *
 * NOTA (pendiente, sesión supervisada): el blindaje definitivo es a nivel de
 * base de datos (GRANT por columna). Requiere probar en vivo los flujos de
 * Stripe/cron antes de aplicarse. Ver REPORTE_E1.md.
 */

export const QUOTE_CLIENT_COLUMNS = [
  "id",
  "user_id",
  "service_category",
  "service_subtype",
  "service_type",
  "bedrooms",
  "bathrooms",
  "square_feet",
  "pets_count",
  "pets_type",
  "residents",
  "days_since_cleaning",
  "address",
  "zone",
  "postal_code",
  "day_of_week",
  "is_preferred_day",
  "base_price",
  "organic_multiplier",
  "organic_adjustment",
  "recency_multiplier",
  "recency_adjustment",
  "zone_surcharge",
  "logistics_surcharge",
  "rule_adjustment",
  "applied_rules",
  "subtotal",
  "gst",
  "pst",
  "total",
  "hold_amount",
  "price_frozen_until",
  "status",
  "admin_review_required", // solo el booleano — el motivo es interno
  "consent_tc",
  "consent_pipa",
  "consent_marketing",
  "consent_photo_marketing",
  "purchase_order",
  "created_at",
].join(", ") as "*"; // cast: supabase-js no parsea strings dinámicos; runtime envía la lista real

export const ORDER_CLIENT_COLUMNS = [
  "id",
  "quote_id",
  "user_id",
  "service_date",
  "service_time",
  "service_datetime",
  "status",
  "payment_option",
  "hold_amount",
  "cancellation_window_hours",
  "wallet_amount_used",
  "total_paid",
  "warranty_status",
  "created_at",
].join(", ") as "*"; // cast: ver nota arriba

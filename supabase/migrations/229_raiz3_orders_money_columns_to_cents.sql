-- RAÍZ-3 (auditoría 2026-07-21, INFORME_LOGICA_NEGOCIO_ROLES_2026-07-21.md
-- §2.3, hallazgo B-P1-1) — Unificación de unidades monetarias de `orders`.
--
-- DIAGNÓSTICO: conviven tres representaciones de dinero en el sistema:
--   - quotes.total/subtotal/gst/pst: dólares con decimales (subtotal es
--     INTEGER dólares, gst/pst/total son NUMERIC(10,2) dólares). Tabla
--     `quotes` NO se toca en esta migración -- fuera de alcance, y cambiar
--     su unidad implicaría re-firmar el contrato de precio congelado.
--   - orders.total_paid / hold_amount / hold_authorized_amount /
--     wallet_amount_used / card_amount_charged: dólares ENTEROS (columnas
--     INTEGER, 001_modulo1_base_schema.sql:82, 017_critical_fixes_hold_
--     dispatch_geofence.sql:19, 025_modulo2_wallet.sql:64-66). Pierden los
--     centavos de la cotización sellada en cada redondeo -- ESTAS son el
--     objetivo de esta migración.
--   - client_wallets.balance / wallet_transactions.amount / *_cents en
--     general: ya centavos enteros, correcto -- no se tocan.
--
-- Esta migración deja las 5 columnas de `orders` en centavos enteros,
-- consistentes con el resto del sistema financiero (shadow_ledger_entries,
-- client_wallets, payroll_entries, qbo_export_lines, etc.), eliminando la
-- pérdida de centavos por redondeo y los errores de factor 100 descritos
-- en el informe (B-P0-5, B-P1-3 parcialmente, y las tres consecuencias
-- verificadas de RAÍZ-3).
--
-- PASO 1: convertir el valor existente de dólares a centavos ANTES de
-- renombrar. ROUND(x * 100) sobre NULL da NULL (seguro); todas estas
-- columnas son NOT NULL DEFAULT 0 en su definición original, así que en la
-- práctica nunca hay NULL, pero el ROUND se escribe de forma segura de
-- todas formas.
UPDATE orders
SET
  total_paid = ROUND(total_paid * 100),
  hold_amount = ROUND(hold_amount * 100),
  hold_authorized_amount = ROUND(hold_authorized_amount * 100),
  wallet_amount_used = ROUND(wallet_amount_used * 100),
  card_amount_charged = ROUND(card_amount_charged * 100)
WHERE total_paid IS NOT NULL
   OR hold_amount IS NOT NULL
   OR hold_authorized_amount IS NOT NULL
   OR wallet_amount_used IS NOT NULL
   OR card_amount_charged IS NOT NULL;

-- PASO 2: renombrar las columnas. Postgres propaga automáticamente el
-- rename a cualquier vista dependiente (orders_client_view, migración 056;
-- order_payment_summary, migración 027) -- no rompe esas vistas, pero SÍ
-- cambia el nombre de columna que exponen, así que el código que las
-- consulta también se actualiza en esta sesión (ver migración 230 para
-- las vistas/función que necesitan ajuste de UNIDADES, no solo de nombre,
-- porque mezclaban esta columna con quotes.total en dólares).
ALTER TABLE orders RENAME COLUMN total_paid TO total_paid_cents;
ALTER TABLE orders RENAME COLUMN hold_amount TO hold_amount_cents;
ALTER TABLE orders RENAME COLUMN hold_authorized_amount TO hold_authorized_amount_cents;
ALTER TABLE orders RENAME COLUMN wallet_amount_used TO wallet_amount_used_cents;
ALTER TABLE orders RENAME COLUMN card_amount_charged TO card_amount_charged_cents;

-- PASO 3: documentar la unidad en cada columna para que ningún desarrollo
-- futuro repita la confusión de unidades diagnosticada en RAÍZ-3.
COMMENT ON COLUMN orders.total_paid_cents IS
  'RAÍZ-3 (auditoría 2026-07-21): monto total cobrado al cliente por esta orden, en CENTAVOS ENTEROS (no dólares). Dividir por 100 al convertir a display de dólares. Antes de esta migración era INTEGER en dólares (perdía centavos por redondeo).';

COMMENT ON COLUMN orders.hold_amount_cents IS
  'RAÍZ-3 (auditoría 2026-07-21): monto del Hold planeado (spec v8.2: MAX(fórmula_base, 40% del total)), en CENTAVOS ENTEROS (no dólares). Dividir por 100 al convertir a display de dólares.';

COMMENT ON COLUMN orders.hold_authorized_amount_cents IS
  'RAÍZ-3 (auditoría 2026-07-21): monto del Hold efectivamente autorizado en Stripe (T-72h), en CENTAVOS ENTEROS (no dólares). Dividir por 100 al convertir a display de dólares.';

COMMENT ON COLUMN orders.wallet_amount_used_cents IS
  'RAÍZ-3 (auditoría 2026-07-21): monto de crédito de Lulu Wallet aplicado a esta orden, en CENTAVOS ENTEROS (no dólares). Ya estaba en centavos en client_wallets/wallet_transactions -- esta columna arrastraba una conversión a dólares que descuadraba el ledger (B-P0-5). Dividir por 100 al convertir a display de dólares.';

COMMENT ON COLUMN orders.card_amount_charged_cents IS
  'RAÍZ-3 (auditoría 2026-07-21): monto efectivamente cobrado por tarjeta (Stripe) para esta orden, en CENTAVOS ENTEROS (no dólares). Dividir por 100 al convertir a display de dólares.';

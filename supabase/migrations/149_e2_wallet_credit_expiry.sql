-- Migración 149 — v8.3 E2.10: Billetera Lulu (créditos de referidos/
-- resoluciones/promos, expiración 12 meses, visible en cotización).
--
-- Las tablas client_wallets/wallet_transactions (migración 025) existían
-- pero ningún código las usaba -- ni ruta ni UI, huérfanas por completo. Esta
-- migración solo agrega lo que faltaba para cerrar el criterio de
-- "expiración 12 meses": una columna `expires_at` en wallet_transactions
-- para los créditos con vencimiento (tipo 'credit'/'promo'; los reembolsos
-- por disputa y los payouts NO expiran -- son dinero que ya era del cliente
-- o pago a un tercero, no un incentivo de retención).

ALTER TABLE wallet_transactions
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_expires ON wallet_transactions(expires_at)
  WHERE expires_at IS NOT NULL;

COMMENT ON COLUMN wallet_transactions.expires_at IS
  'v8.3 E2.10: solo se llena para type IN (credit, promo). NULL para debit/refund/payout (no expiran). El saldo disponible real se calcula en src/lib/wallet.ts con FIFO contra esta fecha, no solo restando client_wallets.balance.';

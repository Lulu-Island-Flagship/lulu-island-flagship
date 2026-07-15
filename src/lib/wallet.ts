/**
 * v8.3 E2.10 — Billetera Lulu: créditos de referidos/resoluciones/promos,
 * expiración 12 meses, visible en cotización.
 *
 * `client_wallets.balance` es un saldo corriente (se actualiza en cada
 * transacción), pero NO sabe por sí solo cuánto de ese saldo corresponde a
 * créditos ya vencidos y no gastados -- eso requiere reconstruir el
 * historial en orden FIFO (el crédito más antiguo se consume primero) y
 * comparar cada lote contra su fecha de expiración. Estas funciones son
 * puras: reciben el historial de transacciones ya consultado y deciden,
 * nunca tocan la base de datos.
 */

export const WALLET_CREDIT_EXPIRY_MONTHS = 12;

export type WalletTransactionType = "credit" | "debit" | "refund" | "promo" | "payout";

/** Solo los créditos de retención/incentivo expiran. Reembolsos y payouts son dinero que ya era del cliente o pago a un tercero -- nunca expiran. */
export function isExpiringWalletCreditType(type: WalletTransactionType): boolean {
  return type === "credit" || type === "promo";
}

/** createdAtIso -> fecha de expiración ISO (+12 meses calendario). */
export function computeWalletCreditExpiryDate(createdAtIso: string): string {
  const d = new Date(createdAtIso);
  d.setUTCMonth(d.getUTCMonth() + WALLET_CREDIT_EXPIRY_MONTHS);
  return d.toISOString();
}

export interface WalletTransactionRecord {
  id: string;
  type: WalletTransactionType;
  /** Siempre positivo -- la dirección (suma/resta del saldo) la determina `type`. */
  amount: number;
  createdAtIso: string;
  expiresAtIso: string | null;
}

interface CreditLot {
  id: string;
  remaining: number;
  expiresAtIso: string | null;
}

/**
 * Reconstruye el consumo FIFO: los débitos consumen primero los créditos más
 * antiguos. Devuelve los lotes de crédito con lo que les queda sin consumir.
 * Solo se consideran depósitos que expiran (credit/promo); refund/payout no
 * participan de esta cuenta porque nunca vencen (siempre están "disponibles"
 * y se descuentan directo del balance, no de estos lotes).
 */
function buildRemainingCreditLots(transactions: WalletTransactionRecord[]): CreditLot[] {
  const deposits = transactions
    .filter((t) => isExpiringWalletCreditType(t.type))
    .sort((a, b) => new Date(a.createdAtIso).getTime() - new Date(b.createdAtIso).getTime())
    .map((t): CreditLot => ({ id: t.id, remaining: t.amount, expiresAtIso: t.expiresAtIso }));

  const debitAmountTotal = transactions
    .filter((t) => t.type === "debit" || t.type === "payout")
    .reduce((sum, t) => sum + t.amount, 0);

  let toConsume = debitAmountTotal;
  for (const lot of deposits) {
    if (toConsume <= 0) break;
    const consumed = Math.min(lot.remaining, toConsume);
    lot.remaining -= consumed;
    toConsume -= consumed;
  }

  return deposits;
}

/**
 * Monto total de créditos vencidos (expires_at < nowIso) que quedaron sin
 * consumir -- esto es lo que hay que restar del balance corriente para
 * saber cuánto es realmente gastable HOY.
 */
export function computeExpiredUnusedAmount(transactions: WalletTransactionRecord[], nowIso: string): number {
  const lots = buildRemainingCreditLots(transactions);
  const nowMs = new Date(nowIso).getTime();
  return lots
    .filter((lot) => lot.expiresAtIso !== null && new Date(lot.expiresAtIso).getTime() < nowMs && lot.remaining > 0)
    .reduce((sum, lot) => sum + lot.remaining, 0);
}

/** Saldo real disponible para gastar hoy = balance corriente − créditos vencidos sin usar. Nunca negativo. */
export function computeAvailableWalletBalance(currentBalance: number, expiredUnusedAmount: number): number {
  return Math.max(0, currentBalance - expiredUnusedAmount);
}

/**
 * Cuánto del monto disponible se puede aplicar a una cotización: el menor
 * entre el saldo disponible y el total de la orden (nunca deja balance
 * negativo, nunca "presta" más de lo que hay).
 */
export function computeWalletApplication(availableBalance: number, orderTotalCents: number): number {
  return Math.max(0, Math.min(availableBalance, orderTotalCents));
}

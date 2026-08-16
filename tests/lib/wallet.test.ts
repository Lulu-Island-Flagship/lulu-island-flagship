import { describe, it } from "node:test";
import assert from "node:assert";
import {
  computeWalletCreditExpiryDate,
  isExpiringWalletCreditType,
  computeExpiredUnusedAmount,
  computeAvailableWalletBalance,
  computeWalletApplication,
  WALLET_CREDIT_EXPIRY_MONTHS,
  type WalletTransactionRecord,
} from "../../src/lib/wallet";

describe("computeWalletCreditExpiryDate", () => {
  it("suma 12 meses calendario", () => {
    assert.equal(computeWalletCreditExpiryDate("2026-01-15T10:00:00.000Z"), "2027-01-15T10:00:00.000Z");
    assert.equal(WALLET_CREDIT_EXPIRY_MONTHS, 12);
  });
});

describe("isExpiringWalletCreditType", () => {
  it("credit y promo expiran", () => {
    assert.equal(isExpiringWalletCreditType("credit"), true);
    assert.equal(isExpiringWalletCreditType("promo"), true);
  });
  it("refund, debit y payout no expiran", () => {
    assert.equal(isExpiringWalletCreditType("refund"), false);
    assert.equal(isExpiringWalletCreditType("debit"), false);
    assert.equal(isExpiringWalletCreditType("payout"), false);
  });
});

describe("computeExpiredUnusedAmount (FIFO)", () => {
  const NOW = "2027-06-01T00:00:00.000Z";

  it("sin transacciones, nada vencido", () => {
    assert.equal(computeExpiredUnusedAmount([], NOW), 0n);
  });

  it("un crédito vencido sin usar cuenta completo como vencido", () => {
    const txs: WalletTransactionRecord[] = [
      { id: "1", type: "credit", amount: 3000n, createdAtIso: "2026-01-01T00:00:00.000Z", expiresAtIso: "2027-01-01T00:00:00.000Z" },
    ];
    assert.equal(computeExpiredUnusedAmount(txs, NOW), 3000n);
  });

  it("un crédito vigente (no vencido) no cuenta como vencido", () => {
    const txs: WalletTransactionRecord[] = [
      { id: "1", type: "credit", amount: 3000n, createdAtIso: "2027-01-01T00:00:00.000Z", expiresAtIso: "2028-01-01T00:00:00.000Z" },
    ];
    assert.equal(computeExpiredUnusedAmount(txs, NOW), 0n);
  });

  it("un débito consume el crédito más antiguo primero (FIFO) — nada queda vencido si ya se gastó todo", () => {
    const txs: WalletTransactionRecord[] = [
      { id: "1", type: "credit", amount: 3000n, createdAtIso: "2026-01-01T00:00:00.000Z", expiresAtIso: "2027-01-01T00:00:00.000Z" },
      { id: "2", type: "debit", amount: 3000n, createdAtIso: "2026-06-01T00:00:00.000Z", expiresAtIso: null },
    ];
    assert.equal(computeExpiredUnusedAmount(txs, NOW), 0n);
  });

  it("débito parcial deja un remanente del lote más antiguo que sí puede vencer", () => {
    const txs: WalletTransactionRecord[] = [
      { id: "1", type: "credit", amount: 3000n, createdAtIso: "2026-01-01T00:00:00.000Z", expiresAtIso: "2027-01-01T00:00:00.000Z" },
      { id: "2", type: "debit", amount: 1000n, createdAtIso: "2026-06-01T00:00:00.000Z", expiresAtIso: null },
    ];
    // quedan 2000 sin gastar de ese lote, y ya venció (2027-01-01 < NOW 2027-06-01)
    assert.equal(computeExpiredUnusedAmount(txs, NOW), 2000n);
  });

  it("dos lotes: el débito consume primero el más antiguo, dejando vencido solo lo que sobra de ese lote", () => {
    const txs: WalletTransactionRecord[] = [
      { id: "1", type: "credit", amount: 1000n, createdAtIso: "2026-01-01T00:00:00.000Z", expiresAtIso: "2027-01-01T00:00:00.000Z" }, // vencido
      { id: "2", type: "credit", amount: 1000n, createdAtIso: "2026-08-01T00:00:00.000Z", expiresAtIso: "2027-08-01T00:00:00.000Z" }, // vigente
      { id: "3", type: "debit", amount: 500n, createdAtIso: "2026-09-01T00:00:00.000Z", expiresAtIso: null },
    ];
    // el débito de 500 consume 500 del lote 1 (más antiguo) -> quedan 500 del lote 1 (vencido) + 1000 del lote 2 (vigente)
    assert.equal(computeExpiredUnusedAmount(txs, NOW), 500n);
  });

  it("refund no participa de la cuenta de vencimiento (nunca vence)", () => {
    const txs: WalletTransactionRecord[] = [
      { id: "1", type: "refund", amount: 5000n, createdAtIso: "2020-01-01T00:00:00.000Z", expiresAtIso: null },
    ];
    assert.equal(computeExpiredUnusedAmount(txs, NOW), 0n);
  });
});

describe("computeAvailableWalletBalance", () => {
  it("resta lo vencido del balance corriente", () => {
    assert.equal(computeAvailableWalletBalance(5000n, 2000n), 3000n);
  });
  it("nunca negativo", () => {
    assert.equal(computeAvailableWalletBalance(1000n, 5000n), 0n);
  });
});

describe("computeWalletApplication", () => {
  it("aplica el menor entre saldo disponible y total de la orden", () => {
    assert.equal(computeWalletApplication(3000n, 5000n), 3000n);
    assert.equal(computeWalletApplication(6000n, 5000n), 5000n);
  });
  it("nunca negativo", () => {
    assert.equal(computeWalletApplication(-100n, 5000n), 0n);
  });
});

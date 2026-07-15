import { describe, it } from "node:test";
import assert from "node:assert";
import {
  evaluatePurchaseOrderEscalation,
  evaluatePendingPurchaseOrders,
  type PendingPurchaseOrder,
} from "../../src/lib/purchase-order-escalation";

const NOW = "2026-07-14T12:00:00.000Z";

function po(overrides: Partial<PendingPurchaseOrder>): PendingPurchaseOrder {
  return {
    id: "po-1",
    status: "pending_approval",
    createdAt: NOW,
    reminderSentAt: null,
    stockoutAlertSentAt: null,
    ...overrides,
  };
}

describe("evaluatePurchaseOrderEscalation", () => {
  it("does not flag a fresh PO (0h)", () => {
    const result = evaluatePurchaseOrderEscalation(po({ createdAt: NOW }), NOW);
    assert.equal(result.shouldSendReminder, false);
    assert.equal(result.shouldSendStockoutAlert, false);
  });

  it("does not flag a PO under 48h", () => {
    const createdAt = "2026-07-13T13:00:00.000Z"; // 23h before NOW
    const result = evaluatePurchaseOrderEscalation(po({ createdAt }), NOW);
    assert.equal(result.shouldSendReminder, false);
    assert.equal(result.shouldSendStockoutAlert, false);
  });

  it("flags reminder at exactly 48h", () => {
    const createdAt = "2026-07-12T12:00:00.000Z"; // exactly 48h before NOW
    const result = evaluatePurchaseOrderEscalation(po({ createdAt }), NOW);
    assert.equal(result.shouldSendReminder, true);
    assert.equal(result.shouldSendStockoutAlert, false);
  });

  it("does not re-flag reminder if already sent", () => {
    const createdAt = "2026-07-10T12:00:00.000Z"; // 96h before NOW
    const result = evaluatePurchaseOrderEscalation(
      po({ createdAt, reminderSentAt: "2026-07-12T13:00:00.000Z" }),
      NOW
    );
    assert.equal(result.shouldSendReminder, false);
  });

  it("flags stockout alert at exactly 72h", () => {
    const createdAt = "2026-07-11T12:00:00.000Z"; // exactly 72h before NOW
    const result = evaluatePurchaseOrderEscalation(po({ createdAt }), NOW);
    assert.equal(result.shouldSendStockoutAlert, true);
  });

  it("flags both reminder and stockout alert together if both are unset past 72h", () => {
    const createdAt = "2026-07-10T12:00:00.000Z"; // 96h before NOW
    const result = evaluatePurchaseOrderEscalation(po({ createdAt }), NOW);
    assert.equal(result.shouldSendReminder, true);
    assert.equal(result.shouldSendStockoutAlert, true);
  });

  it("still flags stockout alert even if reminder already sent", () => {
    const createdAt = "2026-07-10T12:00:00.000Z"; // 96h before NOW
    const result = evaluatePurchaseOrderEscalation(
      po({ createdAt, reminderSentAt: "2026-07-12T13:00:00.000Z" }),
      NOW
    );
    assert.equal(result.shouldSendReminder, false);
    assert.equal(result.shouldSendStockoutAlert, true);
  });

  it("does not re-flag stockout alert if already sent", () => {
    const createdAt = "2026-07-10T12:00:00.000Z";
    const result = evaluatePurchaseOrderEscalation(
      po({ createdAt, stockoutAlertSentAt: "2026-07-13T12:00:00.000Z" }),
      NOW
    );
    assert.equal(result.shouldSendStockoutAlert, false);
  });

  it("never flags a PO that is no longer pending_approval", () => {
    const createdAt = "2026-07-01T12:00:00.000Z"; // very old
    const result = evaluatePurchaseOrderEscalation(po({ createdAt, status: "approved" }), NOW);
    assert.equal(result.shouldSendReminder, false);
    assert.equal(result.shouldSendStockoutAlert, false);
  });

  it("evaluatePendingPurchaseOrders filters out POs needing no action", () => {
    const list: PendingPurchaseOrder[] = [
      po({ id: "fresh", createdAt: NOW }),
      po({ id: "overdue", createdAt: "2026-07-10T12:00:00.000Z" }),
      po({ id: "done", createdAt: "2026-07-01T12:00:00.000Z", status: "received" }),
    ];
    const decisions = evaluatePendingPurchaseOrders(list, NOW);
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].id, "overdue");
  });
});

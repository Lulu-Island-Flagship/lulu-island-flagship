import { describe, it } from "node:test";
import assert from "node:assert";
import {
  buildIdempotencyKey,
  buildShadowLedgerEntry,
  replayOrderBalance,
} from "../../src/lib/shadow-ledger";

describe("buildIdempotencyKey", () => {
  it("usa la referencia externa cuando existe", () => {
    const k = buildIdempotencyKey({
      eventType: "hold_captured",
      externalReference: "pi_123",
      orderId: "order_1",
    });
    assert.equal(k, "hold_captured:pi_123");
  });

  it("cae a orderId si no hay referencia externa", () => {
    const k = buildIdempotencyKey({
      eventType: "capture_failed",
      externalReference: null,
      orderId: "order_1",
    });
    assert.equal(k, "capture_failed:order_1");
  });

  it("es determinística: mismo input siempre produce la misma clave", () => {
    const a = buildIdempotencyKey({ eventType: "balance_captured", externalReference: "pi_9", orderId: "o1" });
    const b = buildIdempotencyKey({ eventType: "balance_captured", externalReference: "pi_9", orderId: "o1" });
    assert.equal(a, b);
  });
});

describe("buildShadowLedgerEntry", () => {
  it("arma el registro con sync_status inicial siempre pending_qbo_sync", () => {
    const entry = buildShadowLedgerEntry({
      eventType: "hold_captured",
      orderId: "order_1",
      userId: "user_1",
      amountCents: 24750,
      processor: "stripe",
      externalReference: "pi_abc",
      occurredAt: "2026-07-10T02:00:00.000Z",
    });
    assert.equal(entry.sync_status, "pending_qbo_sync");
    assert.equal(entry.amount_cents, 24750);
    assert.equal(entry.currency, "cad");
    assert.equal(entry.idempotency_key, "hold_captured:pi_abc");
  });

  it("redondea el monto a entero de cents", () => {
    const entry = buildShadowLedgerEntry({
      eventType: "balance_captured",
      orderId: "order_1",
      userId: null,
      amountCents: 1999.6,
      processor: "stripe",
      externalReference: "pi_x",
      occurredAt: new Date("2026-07-10T02:00:00.000Z"),
    });
    assert.equal(entry.amount_cents, 2000);
  });

  it("rechaza montos negativos (la direccion la da event_type, no el signo)", () => {
    assert.throws(() =>
      buildShadowLedgerEntry({
        eventType: "paypal_refund",
        orderId: "order_1",
        userId: null,
        amountCents: -500,
        processor: "paypal",
        externalReference: "txn_1",
        occurredAt: new Date(),
      })
    );
  });

  it("acepta processor 'internal' sin referencia externa", () => {
    const entry = buildShadowLedgerEntry({
      eventType: "warranty_refund",
      orderId: "order_2",
      userId: "user_2",
      amountCents: 5000,
      processor: "internal",
      externalReference: null,
      occurredAt: new Date(),
      metadata: { reason: "resolved_lulu" },
    });
    assert.equal(entry.external_reference, null);
    assert.deepEqual(entry.metadata, { reason: "resolved_lulu" });
  });
});

describe("replayOrderBalance", () => {
  it("suma cobros y resta reembolsos, ignorando eventos informativos", () => {
    const balance = replayOrderBalance([
      { event_type: "hold_authorized", amount_cents: 24750 }, // informativo, no suma
      { event_type: "hold_captured", amount_cents: 24750 },
      { event_type: "balance_captured", amount_cents: 20000 },
      { event_type: "capture_failed", amount_cents: 20000 }, // informativo, no suma
      { event_type: "warranty_refund", amount_cents: 5000 },
    ]);
    assert.equal(balance.totalCollectedCents, 44750);
    assert.equal(balance.totalRefundedCents, 5000);
    assert.equal(balance.netCents, 39750);
  });

  it("con lista vacía devuelve todo en cero", () => {
    const balance = replayOrderBalance([]);
    assert.equal(balance.totalCollectedCents, 0);
    assert.equal(balance.totalRefundedCents, 0);
    assert.equal(balance.netCents, 0);
  });

  it("cancelacion >72h: hold_released deja neto en cero", () => {
    const balance = replayOrderBalance([
      { event_type: "hold_authorized", amount_cents: 24750 },
      { event_type: "hold_released", amount_cents: 0 },
    ]);
    assert.equal(balance.netCents, 0);
  });
});

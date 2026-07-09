/**
 * v8.3 E4 — Tests de la logica pura de la cola offline (sin IndexedDB).
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import {
  nextRetryDelayMs,
  isReadyForRetry,
  hasExhaustedRetries,
  planSync,
  MAX_SYNC_ATTEMPTS,
  type QueuedServiceEvent,
} from "../../src/lib/offline-queue";

const item = (over: Partial<QueuedServiceEvent>): QueuedServiceEvent => ({
  localId: "1",
  orderId: "order-1",
  eventType: "t_in",
  payload: {},
  capturedAtIso: "2026-07-09T10:00:00Z",
  attempts: 0,
  lastAttemptAtIso: null,
  lastError: null,
  ...over,
});

describe("nextRetryDelayMs", () => {
  it("crece exponencialmente con los intentos", () => {
    assert.equal(nextRetryDelayMs(0), 5000);
    assert.equal(nextRetryDelayMs(1), 10000);
    assert.equal(nextRetryDelayMs(2), 20000);
  });
  it("tiene un techo de 5 minutos", () => {
    assert.equal(nextRetryDelayMs(20), 5 * 60 * 1000);
  });
});

describe("isReadyForRetry", () => {
  it("nunca intentado antes: siempre listo", () => {
    assert.equal(isReadyForRetry(item({ lastAttemptAtIso: null }), "2026-07-09T10:00:00Z"), true);
  });
  it("antes de que pase el delay: no listo", () => {
    const i = item({ attempts: 1, lastAttemptAtIso: "2026-07-09T10:00:00Z" });
    assert.equal(isReadyForRetry(i, "2026-07-09T10:00:05Z"), false); // delay de 10s
  });
  it("despues de pasar el delay: listo", () => {
    const i = item({ attempts: 1, lastAttemptAtIso: "2026-07-09T10:00:00Z" });
    assert.equal(isReadyForRetry(i, "2026-07-09T10:00:11Z"), true);
  });
});

describe("hasExhaustedRetries", () => {
  it("por debajo del maximo, no esta agotado", () => {
    assert.equal(hasExhaustedRetries(item({ attempts: MAX_SYNC_ATTEMPTS - 1 })), false);
  });
  it("al llegar al maximo, esta agotado", () => {
    assert.equal(hasExhaustedRetries(item({ attempts: MAX_SYNC_ATTEMPTS })), true);
  });
});

describe("planSync", () => {
  it("separa items listos, esperando, y agotados (revision manual)", () => {
    const now = "2026-07-09T10:00:00Z";
    const ready = item({ localId: "ready" });
    const waiting = item({ localId: "waiting", attempts: 1, lastAttemptAtIso: now });
    const exhausted = item({ localId: "exhausted", attempts: MAX_SYNC_ATTEMPTS });

    const plan = planSync([ready, waiting, exhausted], now);
    assert.equal(plan.toSync.length, 1);
    assert.equal(plan.toSync[0].localId, "ready");
    assert.equal(plan.waiting.length, 1);
    assert.equal(plan.needsManualReview.length, 1);
  });

  it("nunca descarta datos: el total siempre cuadra", () => {
    const now = "2026-07-09T10:00:00Z";
    const queue = [
      item({ localId: "a" }),
      item({ localId: "b", attempts: MAX_SYNC_ATTEMPTS }),
      item({ localId: "c", attempts: 2, lastAttemptAtIso: now }),
    ];
    const plan = planSync(queue, now);
    const total = plan.toSync.length + plan.waiting.length + plan.needsManualReview.length;
    assert.equal(total, queue.length);
  });

  it("ordena t_in antes que t_out (secuencia que el servidor valida)", () => {
    const now = "2026-07-09T10:00:00Z";
    const queue = [
      item({ localId: "out", eventType: "t_out", capturedAtIso: "2026-07-09T09:00:00Z" }),
      item({ localId: "in", eventType: "t_in", capturedAtIso: "2026-07-09T09:30:00Z" }),
    ];
    const plan = planSync(queue, now);
    assert.equal(plan.toSync[0].localId, "in");
    assert.equal(plan.toSync[1].localId, "out");
  });
});

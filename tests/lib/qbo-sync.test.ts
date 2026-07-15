import { describe, it } from "node:test";
import assert from "node:assert";
import {
  decideQboSyncAction,
  computeQboBackoffMinutes,
  evaluateQboDivergence,
  MAX_QBO_SYNC_ATTEMPTS,
  QBO_DIVERGENCE_ALERT_THRESHOLD,
} from "../../src/lib/qbo-sync";

describe("computeQboBackoffMinutes", () => {
  it("crece exponencialmente: 5, 10, 20, 40, 80", () => {
    assert.equal(computeQboBackoffMinutes(1), 5);
    assert.equal(computeQboBackoffMinutes(2), 10);
    assert.equal(computeQboBackoffMinutes(3), 20);
    assert.equal(computeQboBackoffMinutes(4), 40);
    assert.equal(computeQboBackoffMinutes(5), 80);
  });
});

describe("decideQboSyncAction", () => {
  const NOW = "2026-07-14T12:00:00.000Z";

  it("primer intento (0 intentos previos) siempre intenta ahora", () => {
    const decision = decideQboSyncAction({ attempts: 0, lastAttemptAtIso: null }, NOW);
    assert.equal(decision.action, "attempt_now");
  });

  it("espera el backoff si no ha pasado suficiente tiempo desde el último intento", () => {
    const decision = decideQboSyncAction(
      { attempts: 1, lastAttemptAtIso: "2026-07-14T11:58:00.000Z" }, // hace 2 min, backoff intento 1 = 5min
      NOW
    );
    assert.equal(decision.action, "wait_backoff");
  });

  it("reintenta una vez cumplido el backoff", () => {
    const decision = decideQboSyncAction(
      { attempts: 1, lastAttemptAtIso: "2026-07-14T11:50:00.000Z" }, // hace 10 min, backoff intento 1 = 5min
      NOW
    );
    assert.equal(decision.action, "attempt_now");
  });

  it("se rinde (pending_sync) al agotar el máximo de intentos", () => {
    const decision = decideQboSyncAction(
      { attempts: MAX_QBO_SYNC_ATTEMPTS, lastAttemptAtIso: "2020-01-01T00:00:00.000Z" },
      NOW
    );
    assert.equal(decision.action, "give_up_pending_sync");
    assert.equal(MAX_QBO_SYNC_ATTEMPTS, 5);
  });
});

describe("evaluateQboDivergence", () => {
  it("sin divergencia cuando los totales coinciden", () => {
    const r = evaluateQboDivergence(100000, 100000);
    assert.equal(r.divergenceRatio, 0);
    assert.equal(r.exceedsThreshold, false);
  });

  it("no dispara alerta con divergencia justo bajo el umbral (0.1%)", () => {
    const r = evaluateQboDivergence(100000, 100099); // 0.099% diff
    assert.equal(r.exceedsThreshold, false);
  });

  it("dispara alerta con divergencia sobre el umbral", () => {
    const r = evaluateQboDivergence(100000, 100200); // 0.2% diff
    assert.equal(r.exceedsThreshold, true);
    assert.equal(QBO_DIVERGENCE_ALERT_THRESHOLD, 0.001);
  });

  it("shadow=0 y qbo!=0 siempre diverge", () => {
    const r = evaluateQboDivergence(0, 500);
    assert.equal(r.exceedsThreshold, true);
  });

  it("shadow=0 y qbo=0 no diverge", () => {
    const r = evaluateQboDivergence(0, 0);
    assert.equal(r.exceedsThreshold, false);
  });
});

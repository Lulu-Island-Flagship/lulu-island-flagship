import { describe, it } from "node:test";
import assert from "node:assert";
import {
  isDoubleConfirmed,
  evaluateSafetyAbortEscalation,
  exPostReviewRequired,
  exPostReviewOutcome,
} from "../../src/lib/safety-abort";

describe("isDoubleConfirmed", () => {
  it("false si falta cualquiera de las dos confirmaciones", () => {
    assert.equal(isDoubleConfirmed(null, null), false);
    assert.equal(isDoubleConfirmed("2026-07-09T10:00:00Z", null), false);
    assert.equal(isDoubleConfirmed(null, "2026-07-09T10:00:01Z"), false);
  });
  it("true solo cuando ambas confirmaciones existen", () => {
    assert.equal(isDoubleConfirmed("2026-07-09T10:00:00Z", "2026-07-09T10:00:01Z"), true);
  });
});

describe("evaluateSafetyAbortEscalation", () => {
  const sosStart = "2026-07-09T10:00:00Z";

  it("antes de 2 min: sos_active", () => {
    const r = evaluateSafetyAbortEscalation(sosStart, "2026-07-09T10:01:30Z", null);
    assert.equal(r.stage, "sos_active");
    assert.equal(r.autoApproved, false);
  });

  it("a los 2 min sin ack: escalated_admin_call", () => {
    const r = evaluateSafetyAbortEscalation(sosStart, "2026-07-09T10:02:00Z", null);
    assert.equal(r.stage, "escalated_admin_call");
  });

  it("entre 2 y 4 min sin ack: sigue en escalated_admin_call", () => {
    const r = evaluateSafetyAbortEscalation(sosStart, "2026-07-09T10:03:30Z", null);
    assert.equal(r.stage, "escalated_admin_call");
  });

  it("a los 4 min sin ack: escalated_emergency_admin", () => {
    const r = evaluateSafetyAbortEscalation(sosStart, "2026-07-09T10:04:00Z", null);
    assert.equal(r.stage, "escalated_emergency_admin");
  });

  it("a los 10 min sin ack: auto_approved", () => {
    const r = evaluateSafetyAbortEscalation(sosStart, "2026-07-09T10:10:00Z", null);
    assert.equal(r.stage, "auto_approved");
    assert.equal(r.autoApproved, true);
  });

  it("mas alla de 10 min sin ack: sigue auto_approved", () => {
    const r = evaluateSafetyAbortEscalation(sosStart, "2026-07-09T10:45:00Z", null);
    assert.equal(r.stage, "auto_approved");
  });

  it("si un admin confirma (acknowledged) antes del auto-approve, detiene la escalacion", () => {
    const r = evaluateSafetyAbortEscalation(sosStart, "2026-07-09T10:07:00Z", "2026-07-09T10:03:00Z");
    assert.equal(r.stage, "acknowledged");
    assert.equal(r.autoApproved, false);
    assert.equal(r.minutesElapsed, 3);
  });
});

describe("exPostReviewRequired", () => {
  it("siempre true, sin excepcion", () => {
    assert.equal(exPostReviewRequired(), true);
  });
});

describe("exPostReviewOutcome", () => {
  it("evidencia respalda al lider: sancion prohibida", () => {
    const r = exPostReviewOutcome(true);
    assert.equal(r.sanctionProhibited, true);
  });
  it("evidencia no respalda al lider: no prohibe sancion, pero exige revision humana", () => {
    const r = exPostReviewOutcome(false);
    assert.equal(r.sanctionProhibited, false);
    assert.match(r.note, /humano/i);
  });
});

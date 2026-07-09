import { describe, it } from "node:test";
import assert from "node:assert";
import {
  requirementsForMethod,
  isKeyProblemEscalationDue,
  validateKeyLog,
} from "../../src/lib/key-handling";

describe("requirementsForMethod", () => {
  it("lockbox exige codigo y foto de cierre", () => {
    const r = requirementsForMethod("lockbox");
    assert.equal(r.requiresLockboxCode, true);
    assert.equal(r.requiresClosingPhoto, true);
    assert.equal(r.requiresConfirmedReturn, false);
  });
  it("en persona exige confirmacion de devolucion", () => {
    const r = requirementsForMethod("in_person");
    assert.equal(r.requiresConfirmedReturn, true);
    assert.equal(r.requiresLockboxCode, false);
  });
  it("tercero exige firma digital", () => {
    const r = requirementsForMethod("third_party");
    assert.equal(r.requiresSignature, true);
  });
  it("problema no exige nada de lo anterior (se resuelve por escalacion)", () => {
    const r = requirementsForMethod("problem");
    assert.equal(r.requiresLockboxCode, false);
    assert.equal(r.requiresConfirmedReturn, false);
    assert.equal(r.requiresSignature, false);
    assert.equal(r.requiresClosingPhoto, false);
  });
});

describe("isKeyProblemEscalationDue", () => {
  it("antes de 15 min no escala", () => {
    assert.equal(isKeyProblemEscalationDue("2026-07-09T10:00:00Z", "2026-07-09T10:10:00Z", null), false);
  });
  it("a los 15+ min sin resolver, escala", () => {
    assert.equal(isKeyProblemEscalationDue("2026-07-09T10:00:00Z", "2026-07-09T10:16:00Z", null), true);
  });
  it("si ya se resolvio, nunca escala", () => {
    assert.equal(
      isKeyProblemEscalationDue("2026-07-09T10:00:00Z", "2026-07-09T11:00:00Z", "2026-07-09T10:05:00Z"),
      false
    );
  });
});

describe("validateKeyLog", () => {
  it("lockbox sin codigo falla", () => {
    const missing = validateKeyLog("lockbox", { closingPhotoUrl: "x" });
    assert.deepEqual(missing, ["lockboxCode"]);
  });
  it("lockbox completo no falla", () => {
    const missing = validateKeyLog("lockbox", { lockboxCode: "1234", closingPhotoUrl: "x" });
    assert.deepEqual(missing, []);
  });
  it("en persona sin confirmar devolucion falla", () => {
    const missing = validateKeyLog("in_person", {});
    assert.deepEqual(missing, ["confirmedReturned"]);
  });
  it("tercero sin firma falla", () => {
    const missing = validateKeyLog("third_party", {});
    assert.deepEqual(missing, ["signatureUrl"]);
  });
  it("problema nunca falla por campos faltantes", () => {
    assert.deepEqual(validateKeyLog("problem", {}), []);
  });
});

import { describe, it } from "node:test";
import assert from "node:assert";
import {
  evaluateCaptureEligibility,
  type OrderClaimForCaptureDecision,
} from "../../src/lib/batch-capture-eligibility";

describe("evaluateCaptureEligibility", () => {
  it("captura si no hay disputas", () => {
    const r = evaluateCaptureEligibility([]);
    assert.equal(r.shouldCapture, true);
    assert.equal(r.reason, "no_open_claims");
    assert.equal(r.blockingClaimId, null);
  });

  it("captura si la única disputa abierta es 'minor' aunque tenga evidencia", () => {
    const claims: OrderClaimForCaptureDecision[] = [
      { id: "c1", status: "open", severity: "minor", hasClientEvidence: true },
    ];
    const r = evaluateCaptureEligibility(claims);
    assert.equal(r.shouldCapture, true);
    assert.equal(r.reason, "open_claims_not_critical_or_not_documented");
  });

  it("captura si la disputa es 'critical' pero sin evidencia del cliente (no documentada)", () => {
    const claims: OrderClaimForCaptureDecision[] = [
      { id: "c1", status: "open", severity: "critical", hasClientEvidence: false },
    ];
    const r = evaluateCaptureEligibility(claims);
    assert.equal(r.shouldCapture, true);
    assert.equal(r.reason, "open_claims_not_critical_or_not_documented");
  });

  it("EXCLUYE la captura si hay disputa critical + open + con evidencia del cliente", () => {
    const claims: OrderClaimForCaptureDecision[] = [
      { id: "c1", status: "open", severity: "critical", hasClientEvidence: true },
    ];
    const r = evaluateCaptureEligibility(claims);
    assert.equal(r.shouldCapture, false);
    assert.equal(r.reason, "critical_documented_dispute_open");
    assert.equal(r.blockingClaimId, "c1");
  });

  it("captura si la disputa critical con evidencia ya está resuelta", () => {
    const claims: OrderClaimForCaptureDecision[] = [
      { id: "c1", status: "resolved_lulu", severity: "critical", hasClientEvidence: true },
    ];
    const r = evaluateCaptureEligibility(claims);
    assert.equal(r.shouldCapture, true);
    assert.equal(r.reason, "no_open_claims");
  });

  it("con múltiples disputas, identifica la primera crítica documentada abierta como bloqueante", () => {
    const claims: OrderClaimForCaptureDecision[] = [
      { id: "c1", status: "resolved_client", severity: "critical", hasClientEvidence: true },
      { id: "c2", status: "open", severity: "minor", hasClientEvidence: true },
      { id: "c3", status: "open", severity: "critical", hasClientEvidence: true },
    ];
    const r = evaluateCaptureEligibility(claims);
    assert.equal(r.shouldCapture, false);
    assert.equal(r.blockingClaimId, "c3");
  });

  it("no confunde 'escalated' con 'open': escalated no bloquea por sí mismo", () => {
    const claims: OrderClaimForCaptureDecision[] = [
      { id: "c1", status: "escalated", severity: "critical", hasClientEvidence: true },
    ];
    const r = evaluateCaptureEligibility(claims);
    assert.equal(r.shouldCapture, true);
    assert.equal(r.reason, "no_open_claims");
  });
});

/**
 * v8.3 E7 — Tests de pre-evaluación de riesgo por dirección.
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import {
  evaluatePropertyRisk,
  evaluateBookingRiskConsequence,
  normalizeAddressForMatch,
} from "../../src/lib/property-risk";

describe("evaluatePropertyRisk — umbrales", () => {
  it("0 flags = estándar", () => {
    const r = evaluatePropertyRisk([]);
    assert.equal(r.tier, "standard");
    assert.equal(r.flagCount, 0);
  });

  it("2 flags = estándar (no cruza el umbral)", () => {
    const r = evaluatePropertyRisk(["steep_stairs", "aggressive_dog"]);
    assert.equal(r.tier, "standard");
  });

  it("3 flags = auditor obligatorio", () => {
    const r = evaluatePropertyRisk(["steep_stairs", "aggressive_dog", "confined_space"]);
    assert.equal(r.tier, "auditor_required");
  });

  it("4 flags = auditor obligatorio (borde superior)", () => {
    const r = evaluatePropertyRisk([
      "steep_stairs",
      "aggressive_dog",
      "confined_space",
      "defective_lockbox",
    ]);
    assert.equal(r.tier, "auditor_required");
  });

  it("5+ flags = inspección previa", () => {
    const r = evaluatePropertyRisk([
      "steep_stairs",
      "aggressive_dog",
      "confined_space",
      "defective_lockbox",
      "mold_over_1sqm",
    ]);
    assert.equal(r.tier, "pre_inspection_required");
  });

  it("flags duplicados no inflan el conteo", () => {
    const r = evaluatePropertyRisk(["steep_stairs", "steep_stairs", "steep_stairs"]);
    assert.equal(r.flagCount, 1);
    assert.equal(r.tier, "standard");
  });
});

describe("evaluatePropertyRisk — consecuencias por flag", () => {
  it("moho >1m² bloquea por completo, sin importar el tier", () => {
    const r = evaluatePropertyRisk(["mold_over_1sqm"]);
    assert.equal(r.hardBlocked, true);
  });

  it("sin moho no hay bloqueo duro", () => {
    const r = evaluatePropertyRisk(["steep_stairs", "aggressive_dog"]);
    assert.equal(r.hardBlocked, false);
  });

  it("escaleras empinadas exige PPE", () => {
    assert.equal(evaluatePropertyRisk(["steep_stairs"]).requiresPPE, true);
  });

  it("perro agresivo exige dueño presente", () => {
    assert.equal(evaluatePropertyRisk(["aggressive_dog"]).requiresOwnerPresent, true);
  });

  it("espacio confinado exige equipo de 2 y check-in a los 15 min", () => {
    const r = evaluatePropertyRisk(["confined_space"]);
    assert.equal(r.requiresTwoPersonTeam, true);
    assert.equal(r.requiresCheckInAt15Min, true);
  });

  it("lockbox defectuoso exige escalacion de llaves", () => {
    assert.equal(evaluatePropertyRisk(["defective_lockbox"]).requiresKeyEscalation, true);
  });
});

describe("evaluateBookingRiskConsequence — conecta el riesgo al momento de reservar (v8.3 E7)", () => {
  it("sin evaluación registrada: permite reservar sin consecuencias", () => {
    const c = evaluateBookingRiskConsequence(null);
    assert.equal(c.allowed, true);
    assert.equal(c.requiresAdminReview, false);
    assert.equal(c.requiresFieldAuditor, false);
  });

  it("tier estándar (0-2 flags): permite reservar sin consecuencias", () => {
    const c = evaluateBookingRiskConsequence({ tier: "standard", hardBlocked: false });
    assert.equal(c.allowed, true);
    assert.equal(c.requiresAdminReview, false);
    assert.equal(c.requiresFieldAuditor, false);
  });

  it("tier auditor_required (3-4 flags): permite reservar pero marca auditor de campo obligatorio", () => {
    const c = evaluateBookingRiskConsequence({ tier: "auditor_required", hardBlocked: false });
    assert.equal(c.allowed, true);
    assert.equal(c.requiresAdminReview, false);
    assert.equal(c.requiresFieldAuditor, true);
  });

  it("tier pre_inspection_required (5+ flags): exige revisión admin antes de permitir la reserva", () => {
    const c = evaluateBookingRiskConsequence({ tier: "pre_inspection_required", hardBlocked: false });
    assert.equal(c.allowed, true); // la cotización se crea, pero admin_review_required bloquea /api/stripe/confirm
    assert.equal(c.requiresAdminReview, true);
    assert.ok(c.adminReviewReason);
  });

  it("hardBlocked (moho >1m²): bloquea la reserva por completo sin importar el tier", () => {
    const c = evaluateBookingRiskConsequence({ tier: "standard", hardBlocked: true });
    assert.equal(c.allowed, false);
    assert.ok(c.blockReason);
  });

  it("hardBlocked con tier pre_inspection_required: sigue bloqueando (no solo revisión)", () => {
    const c = evaluateBookingRiskConsequence({ tier: "pre_inspection_required", hardBlocked: true });
    assert.equal(c.allowed, false);
    assert.equal(c.requiresAdminReview, false);
  });
});

describe("normalizeAddressForMatch", () => {
  it("normaliza espacios y mayúsculas para hacer match consistente", () => {
    assert.equal(
      normalizeAddressForMatch("  123   Main St, Richmond  "),
      "123 main st, richmond"
    );
  });

  it("direcciones equivalentes con distinto formato producen la misma clave", () => {
    assert.equal(
      normalizeAddressForMatch("456 Oak Ave"),
      normalizeAddressForMatch("456   OAK   AVE  ")
    );
  });
});

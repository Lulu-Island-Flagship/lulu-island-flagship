/**
 * v8.3 E7 — Tests de pre-evaluación de riesgo por dirección.
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { evaluatePropertyRisk } from "../../src/lib/property-risk";

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

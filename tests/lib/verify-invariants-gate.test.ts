import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateChange, checkLearningsBidirectionality } from "../../scripts/verify-invariants.mjs";

describe("Gate verify:invariants · validateChange (cobertura semántica)", () => {
  it("acepta un objeto CHANGE completo que cubre los contextos protegidos tocados", () => {
    const validChange = {
      id: "CHG-2026-08-16-001",
      intent: "Refactor seguro de módulo financiero",
      scope: {
        contexts: ["financial", "identity"],
      },
      invariants_affected: ["INST-FIN-001"],
      verification_plan: ["unit", "typecheck"],
      rollback_plan: "Revertir commit",
      evidence: {
        status: "VERIFIED",
      },
    };

    const violations = validateChange(validChange, "test-change", ["financial", "identity"]);
    assert.deepEqual(violations, []);
  });

  it("rechaza un objeto CHANGE si no cubre todos los contextos protegidos del diff", () => {
    const changeSinIdentity = {
      id: "CHG-2026-08-16-002",
      intent: "Cambio solo financiero",
      scope: {
        contexts: ["financial"],
      },
      invariants_affected: ["INST-FIN-001"],
      verification_plan: ["unit"],
      rollback_plan: "Revertir commit",
      evidence: {
        status: "VERIFIED",
      },
    };

    // Si el diff tocó financial e identity, debe fallar porque falta identity
    const violations = validateChange(changeSinIdentity, "test-change", ["financial", "identity"]);
    assert.ok(violations.length > 0);
    assert.ok(violations.some((v) => v.includes("no cubre los contexto(s) protegido(s) tocados [identity]")));
  });

  it("rechaza un objeto CHANGE sin rollback_plan o sin evidence.status", () => {
    const changeIncompleto = {
      id: "CHG-2026-08-16-003",
      intent: "Cambio sin rollback plan",
      invariants_affected: ["INST-FIN-001"],
      verification_plan: ["unit"],
    };

    const violations = validateChange(changeIncompleto, "test-change", []);
    assert.ok(violations.some((v) => v.includes("falta `rollback_plan`")));
    assert.ok(violations.some((v) => v.includes("falta `evidence.status`")));
  });
});

describe("Gate verify:invariants · checkLearningsBidirectionality (Parte 6.4)", () => {
  it("verifica que todas las referencias @incident LEARNING-XXX en el repo están en LEARNINGS.md", () => {
    const result = checkLearningsBidirectionality();
    assert.deepEqual(result.violations, [], `Violaciones de bidireccionalidad: ${result.violations.join("; ")}`);
    assert.ok(result.note && result.note.includes("5 lección(es) en LEARNINGS.md"));
  });
});

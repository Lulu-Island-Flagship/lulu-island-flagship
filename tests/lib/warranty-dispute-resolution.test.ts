import { describe, it } from "node:test";
import assert from "node:assert";
import {
  evaluateWarrantyDisputeResolution,
  type ZoneClosureEvidence,
  type ClientClaimInput,
} from "../../src/lib/warranty-dispute-resolution";

const zonesWithKitchenPhoto: ZoneClosureEvidence[] = [
  { zone: "bathroom", hasClosurePhoto: true, closurePhotoUrls: ["b1.jpg"] },
  { zone: "kitchen", hasClosurePhoto: true, closurePhotoUrls: ["k1.jpg", "k2.jpg"] },
];

const zonesWithoutKitchenPhoto: ZoneClosureEvidence[] = [
  { zone: "bathroom", hasClosurePhoto: true, closurePhotoUrls: ["b1.jpg"] },
  { zone: "kitchen", hasClosurePhoto: false, closurePhotoUrls: [] },
];

describe("evaluateWarrantyDisputeResolution", () => {
  it("caso 1: sin foto de cierre de la zona → auto favor cliente, re-limpieza, sin revisión humana", () => {
    const claim: ClientClaimInput = {
      claimZone: "kitchen",
      claimReason: "zona sucia",
      hasClientEvidence: false,
      clientEvidencePhotoUrls: [],
    };
    const r = evaluateWarrantyDisputeResolution(zonesWithoutKitchenPhoto, claim);
    assert.equal(r.outcome, "auto_favor_client_missing_closure_evidence");
    assert.equal(r.autoResolved, true);
    assert.equal(r.requiresHumanReview, false);
    assert.equal(r.suggestedAction, "free_recleaning");
    assert.equal(r.hasClosureEvidenceForZone, false);
  });

  it("caso 1b: zona reclamada no existe en absoluto en el checklist → tratado igual que sin foto de cierre", () => {
    const claim: ClientClaimInput = {
      claimZone: "garage",
      claimReason: "no se limpió",
      hasClientEvidence: true,
      clientEvidencePhotoUrls: ["c1.jpg"],
    };
    const r = evaluateWarrantyDisputeResolution(zonesWithKitchenPhoto, claim);
    assert.equal(r.outcome, "auto_favor_client_missing_closure_evidence");
    assert.equal(r.autoResolved, true);
    assert.equal(r.requiresHumanReview, false);
  });

  it("caso 2: foto de cierre existe, cliente sin evidencia propia → auto favor equipo, explicación, sin revisión humana", () => {
    const claim: ClientClaimInput = {
      claimZone: "kitchen",
      claimReason: "zona sucia",
      hasClientEvidence: false,
      clientEvidencePhotoUrls: [],
    };
    const r = evaluateWarrantyDisputeResolution(zonesWithKitchenPhoto, claim);
    assert.equal(r.outcome, "auto_favor_team_unsubstantiated_claim");
    assert.equal(r.autoResolved, true);
    assert.equal(r.requiresHumanReview, false);
    assert.equal(r.suggestedAction, "explain_no_action");
    assert.equal(r.hasClosureEvidenceForZone, true);
    assert.equal(r.hasClientEvidence, false);
  });

  it("caso 2b: hasClientEvidence=true pero sin URLs reales → se trata como sin evidencia (dato inconsistente no basta)", () => {
    const claim: ClientClaimInput = {
      claimZone: "kitchen",
      claimReason: "zona sucia",
      hasClientEvidence: true,
      clientEvidencePhotoUrls: [],
    };
    const r = evaluateWarrantyDisputeResolution(zonesWithKitchenPhoto, claim);
    assert.equal(r.outcome, "auto_favor_team_unsubstantiated_claim");
    assert.equal(r.hasClientEvidence, false);
  });

  it("caso 3: ambas partes aportan evidencia para la misma zona → SIEMPRE requiere revisión humana", () => {
    const claim: ClientClaimInput = {
      claimZone: "kitchen",
      claimReason: "encimera con grasa",
      hasClientEvidence: true,
      clientEvidencePhotoUrls: ["client1.jpg"],
    };
    const r = evaluateWarrantyDisputeResolution(zonesWithKitchenPhoto, claim);
    assert.equal(r.outcome, "requires_human_review_contradictory_evidence");
    assert.equal(r.autoResolved, false);
    assert.equal(r.requiresHumanReview, true);
    assert.equal(r.suggestedAction, "human_review");
  });

  it("nunca resuelve automáticamente EN CONTRA del equipo salvo por falta de evidencia de cierre", () => {
    // Recorremos todas las combinaciones posibles y verificamos el invariante:
    // toda decisión "en contra del equipo" (free_recleaning) que sea autoResolved
    // debe venir exclusivamente de hasClosureEvidenceForZone === false.
    const combinations: Array<[boolean, boolean]> = [
      [true, true],
      [true, false],
      [false, true],
      [false, false],
    ];
    for (const [closure, client] of combinations) {
      const zones: ZoneClosureEvidence[] = [
        { zone: "kitchen", hasClosurePhoto: closure, closurePhotoUrls: closure ? ["k.jpg"] : [] },
      ];
      const claim: ClientClaimInput = {
        claimZone: "kitchen",
        claimReason: "test",
        hasClientEvidence: client,
        clientEvidencePhotoUrls: client ? ["c.jpg"] : [],
      };
      const r = evaluateWarrantyDisputeResolution(zones, claim);
      if (r.autoResolved && r.suggestedAction === "free_recleaning") {
        assert.equal(
          r.hasClosureEvidenceForZone,
          false,
          "una re-limpieza automática solo puede darse por falta de evidencia de cierre"
        );
      }
    }
  });
});

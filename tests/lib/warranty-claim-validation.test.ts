import { describe, it } from "node:test";
import assert from "node:assert";
import { validateWarrantyClaimInput } from "../../src/lib/warranty-claim-validation";

const VALID = {
  orderId: "order-123",
  claimZone: "bathroom",
  reason: "Bathroom mirror still had smudges",
};

describe("validateWarrantyClaimInput", () => {
  it("acepta un input mínimo válido", () => {
    assert.deepEqual(validateWarrantyClaimInput(VALID), { valid: true });
  });

  it("rechaza sin orderId", () => {
    const result = validateWarrantyClaimInput({ ...VALID, orderId: undefined });
    assert.equal(result.valid, false);
  });

  it("rechaza sin claimZone", () => {
    const result = validateWarrantyClaimInput({ ...VALID, claimZone: "" });
    assert.equal(result.valid, false);
  });

  it("rechaza reason demasiado corto", () => {
    const result = validateWarrantyClaimInput({ ...VALID, reason: "ok" });
    assert.equal(result.valid, false);
  });

  it("rechaza reason demasiado largo", () => {
    const result = validateWarrantyClaimInput({ ...VALID, reason: "a".repeat(201) });
    assert.equal(result.valid, false);
  });

  it("acepta description opcional válida", () => {
    assert.deepEqual(validateWarrantyClaimInput({ ...VALID, description: "More detail here" }), { valid: true });
  });

  it("rechaza description demasiado larga", () => {
    const result = validateWarrantyClaimInput({ ...VALID, description: "a".repeat(2001) });
    assert.equal(result.valid, false);
  });

  it("acepta photoUrls válidas", () => {
    assert.deepEqual(
      validateWarrantyClaimInput({ ...VALID, photoUrls: ["https://x/a.jpg", "https://x/b.jpg"] }),
      { valid: true }
    );
  });

  it("rechaza photoUrls que no es array", () => {
    const result = validateWarrantyClaimInput({ ...VALID, photoUrls: "not-an-array" });
    assert.equal(result.valid, false);
  });

  it("rechaza más de 6 fotos", () => {
    const result = validateWarrantyClaimInput({
      ...VALID,
      photoUrls: Array.from({ length: 7 }, (_, i) => `https://x/${i}.jpg`),
    });
    assert.equal(result.valid, false);
  });

  it("rechaza strings vacíos dentro de photoUrls", () => {
    const result = validateWarrantyClaimInput({ ...VALID, photoUrls: [""] });
    assert.equal(result.valid, false);
  });
});

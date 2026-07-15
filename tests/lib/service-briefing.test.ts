import { describe, it } from "node:test";
import assert from "node:assert";
import { buildServiceBriefing, type ServiceBriefingInput } from "../../src/lib/service-briefing";

function baseInput(overrides: Partial<ServiceBriefingInput> = {}): ServiceBriefingInput {
  return {
    serviceType: "regular",
    petsCount: 0,
    petsType: "none",
    isNewClient: false,
    hasDisputeHistory: false,
    ...overrides,
  };
}

describe("buildServiceBriefing", () => {
  it("sin tips para un regular sin señales especiales", () => {
    const tips = buildServiceBriefing(baseInput());
    assert.equal(tips.length, 0);
  });

  it("tip de move-out con severidad caution", () => {
    const tips = buildServiceBriefing(baseInput({ serviceType: "move_in_out" }));
    assert.equal(tips.length, 1);
    assert.equal(tips[0].key, "move_out_stress");
    assert.equal(tips[0].severity, "caution");
  });

  it("tip de post-construcción menciona N95", () => {
    const tips = buildServiceBriefing(baseInput({ serviceType: "post_construction" }));
    assert.ok(tips.some((t) => t.key === "post_construction_ppe" && t.message.includes("N95")));
  });

  it("tip de mascotas solo si petsCount > 0", () => {
    const withPets = buildServiceBriefing(baseInput({ petsCount: 2, petsType: "dog" }));
    assert.ok(withPets.some((t) => t.key === "pets_present"));
    const withoutPets = buildServiceBriefing(baseInput({ petsCount: 0 }));
    assert.ok(!withoutPets.some((t) => t.key === "pets_present"));
  });

  it("tip de cliente nuevo", () => {
    const tips = buildServiceBriefing(baseInput({ isNewClient: true }));
    assert.ok(tips.some((t) => t.key === "new_client"));
  });

  it("tip de historial de disputa es 'critical'", () => {
    const tips = buildServiceBriefing(baseInput({ hasDisputeHistory: true }));
    const tip = tips.find((t) => t.key === "dispute_history");
    assert.ok(tip);
    assert.equal(tip!.severity, "critical");
    assert.ok(tip!.message.includes("TODAS las zonas"));
  });

  it("combina múltiples señales a la vez", () => {
    const tips = buildServiceBriefing(
      baseInput({ serviceType: "move_in_out", petsCount: 1, petsType: "cat", isNewClient: true, hasDisputeHistory: true })
    );
    const keys = tips.map((t) => t.key);
    assert.deepEqual(keys.sort(), ["dispute_history", "move_out_stress", "new_client", "pets_present"].sort());
  });
});

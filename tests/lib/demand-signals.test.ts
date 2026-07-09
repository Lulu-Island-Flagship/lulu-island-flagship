import { describe, it } from "node:test";
import assert from "node:assert";
import { calculateDemandMultiplier, decideCampaignTrigger } from "../../src/lib/demand-signals";

describe("calculateDemandMultiplier", () => {
  it("sin senales, multiplicador neutral 1.0", () => {
    assert.equal(calculateDemandMultiplier({}).multiplier, 1.0);
  });

  it("lluvia sola: +30%", () => {
    assert.equal(calculateDemandMultiplier({ isRainy: true }).multiplier, 1.3);
  });

  it("Navidad: +50%", () => {
    assert.equal(calculateDemandMultiplier({ holiday: "christmas" }).multiplier, 1.5);
  });

  it("combina multiples factores multiplicativamente", () => {
    const r = calculateDemandMultiplier({ isRainy: true, isSchoolVacation: true });
    // 1.3 * 0.7 = 0.91
    assert.equal(r.multiplier, 0.91);
    assert.equal(r.appliedFactors.length, 2);
  });

  it("vacaciones escolares: -30%", () => {
    assert.equal(calculateDemandMultiplier({ isSchoolVacation: true }).multiplier, 0.7);
  });
});

describe("decideCampaignTrigger", () => {
  it("demanda favorable dispara aunque no sea la fecha sugerida", () => {
    const r = decideCampaignTrigger("holiday_ready", { holiday: "christmas" }, false);
    assert.equal(r.shouldTrigger, true);
  });

  it("fecha alcanzada + demanda neutral tambien dispara", () => {
    const r = decideCampaignTrigger("spring_refresh", {}, true);
    assert.equal(r.shouldTrigger, true);
  });

  it("demanda desfavorable y fecha no alcanzada: en espera", () => {
    const r = decideCampaignTrigger("summer_prep", { isSchoolVacation: true }, false);
    assert.equal(r.shouldTrigger, false);
  });
});
